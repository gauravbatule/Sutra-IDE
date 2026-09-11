import { Request, Response } from 'express';
import crypto from 'crypto';
import { modelRouter } from '../modelRouter.js';

export interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | any[];
  name?: string;
  tool_calls?: any[];
  tool_call_id?: string;
}

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  tools?: any[];
  tool_choice?: any;
}

export class ChatCompletionsProxy {
  /**
   * Handle incoming /v1/chat/completions request according to OpenAI specification
   */
  public async handleChatCompletion(req: Request, res: Response): Promise<void> {
    const body = req.body as OpenAIChatRequest;
    if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
      res.status(400).json({
        error: {
          message: 'Invalid request: "messages" array is required and must not be empty.',
          type: 'invalid_request_error',
          param: 'messages',
          code: 'missing_required_parameter',
        },
      });
      return;
    }

    const requestedModel = body.model || 'auto';
    const isStream = Boolean(body.stream);
    const systemPromptMessage = body.messages.find((m) => m.role === 'system');
    const systemPrompt = typeof systemPromptMessage?.content === 'string' ? systemPromptMessage.content : undefined;
    const conversationMessages = body.messages.filter((m) => m.role !== 'system');
    const requestId = `chatcmpl-${crypto.randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);

    if (isStream) {
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();

      try {
        for await (const chunk of modelRouter.streamChat({
          messages: conversationMessages as any,
          systemPrompt,
          modelId: requestedModel,
          signal: (req as any).signal,
        })) {
          if (chunk.delta) {
            const streamFrame = {
              id: requestId,
              object: 'chat.completion.chunk',
              created,
              model: requestedModel,
              choices: [
                {
                  index: 0,
                  delta: { content: chunk.delta },
                  finish_reason: null,
                },
              ],
            };
            res.write(`data: ${JSON.stringify(streamFrame)}\n\n`);
          }

          if (chunk.thinking) {
            const reasoningFrame = {
              id: requestId,
              object: 'chat.completion.chunk',
              created,
              model: requestedModel,
              choices: [
                {
                  index: 0,
                  delta: { reasoning_content: chunk.thinking },
                  finish_reason: null,
                },
              ],
            };
            res.write(`data: ${JSON.stringify(reasoningFrame)}\n\n`);
          }

          if (chunk.toolCalls && chunk.toolCalls.length > 0) {
            const toolFrame = {
              id: requestId,
              object: 'chat.completion.chunk',
              created,
              model: requestedModel,
              choices: [
                {
                  index: 0,
                  delta: { tool_calls: chunk.toolCalls },
                  finish_reason: 'tool_calls',
                },
              ],
            };
            res.write(`data: ${JSON.stringify(toolFrame)}\n\n`);
          }

          if (chunk.error) {
            const errorFrame = {
              error: {
                message: chunk.error,
                type: 'upstream_error',
              },
            };
            res.write(`data: ${JSON.stringify(errorFrame)}\n\n`);
          }
        }

        // Final completion frame
        const finalFrame = {
          id: requestId,
          object: 'chat.completion.chunk',
          created,
          model: requestedModel,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: 'stop',
            },
          ],
        };
        res.write(`data: ${JSON.stringify(finalFrame)}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      } catch (err: any) {
        if (!res.headersSent) {
          res.status(500).json({ error: { message: err.message || 'Stream processing failed' } });
        } else {
          res.write(`data: ${JSON.stringify({ error: { message: err.message } })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
        }
      }
    } else {
      // Non-streaming completion accumulation
      try {
        let fullText = '';
        let fullReasoning = '';
        const toolCalls: any[] = [];

        for await (const chunk of modelRouter.streamChat({
          messages: conversationMessages as any,
          systemPrompt,
          modelId: requestedModel,
          signal: (req as any).signal,
        })) {
          if (chunk.delta) fullText += chunk.delta;
          if (chunk.thinking) fullReasoning += chunk.thinking;
          if (chunk.toolCalls) toolCalls.push(...chunk.toolCalls);
        }

        res.json({
          id: requestId,
          object: 'chat.completion',
          created,
          model: requestedModel,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: fullText,
                ...(fullReasoning ? { reasoning_content: fullReasoning } : {}),
                ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
              },
              finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
            },
          ],
          usage: {
            prompt_tokens: Math.ceil(JSON.stringify(body.messages).length / 4),
            completion_tokens: Math.ceil(fullText.length / 4),
            total_tokens: Math.ceil((JSON.stringify(body.messages).length + fullText.length) / 4),
          },
        });
      } catch (err: any) {
        res.status(500).json({
          error: {
            message: err.message || 'Chat completion failed',
            type: 'api_error',
          },
        });
      }
    }
  }
}

export const chatProxy = new ChatCompletionsProxy();
