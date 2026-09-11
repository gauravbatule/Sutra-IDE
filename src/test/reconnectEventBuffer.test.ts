import { describe, it, expect, beforeEach } from 'vitest';
import { StreamReplayBuffer } from '../../server/index.js';

describe('WebSocket Reconnection Event Sourcing & Stream Buffer', () => {
  const testChatId = 'chat-reconnect-test-123';

  beforeEach(() => {
    StreamReplayBuffer.clear(testChatId);
  });

  it('buffers and sequence-tags streaming packets in order', () => {
    const p1 = StreamReplayBuffer.append(testChatId, 'AGENT_STREAM', 'chunk', { delta: 'Hello ' });
    const p2 = StreamReplayBuffer.append(testChatId, 'AGENT_STREAM', 'chunk', { delta: 'world!' });

    expect(p1.seq).toBe(1);
    expect(p2.seq).toBe(2);
    expect(StreamReplayBuffer.getLastSequence(testChatId)).toBe(2);
  });

  it('retrieves only missing packets since a specified sequence number', () => {
    StreamReplayBuffer.append(testChatId, 'AGENT_STREAM', 'chunk', { delta: 'Step 1' });
    StreamReplayBuffer.append(testChatId, 'AGENT_STREAM', 'chunk', { delta: 'Step 2' });
    StreamReplayBuffer.append(testChatId, 'AGENT_STREAM', 'chunk', { delta: 'Step 3' });
    StreamReplayBuffer.append(testChatId, 'AGENT_STREAM', 'chunk', { delta: 'Step 4' });

    // Client reconnects having only seen sequence 2
    const missing = StreamReplayBuffer.getPacketsSince(testChatId, 2);

    expect(missing.length).toBe(2);
    expect(missing[0].payload.delta).toBe('Step 3');
    expect(missing[1].payload.delta).toBe('Step 4');
  });

  it('returns empty array when client is already fully synced', () => {
    StreamReplayBuffer.append(testChatId, 'AGENT_STREAM', 'chunk', { delta: 'Up to date' });
    const missing = StreamReplayBuffer.getPacketsSince(testChatId, 1);
    expect(missing.length).toBe(0);
  });
});
