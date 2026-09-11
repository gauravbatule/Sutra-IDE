export enum WSChannel {
  PTY_INPUT = 0x01,
  PTY_OUTPUT = 0x02,
  PTY_RESIZE = 0x03,
  FS_EVENT = 0x04,
  AGENT_STREAM = 0x05,
  AGENT_TOOL_CALL = 0x06,
  AGENT_APPROVAL = 0x07,
  MOBILE_SYNC = 0x08,
  MEDIA_EVENT = 0x09,
  SWARM_STATE = 0x0a,
  PING_PONG = 0x0f,
}

export interface WSPacket<T = any> {
  channel: WSChannel;
  type: string;
  payload: T;
  timestamp: number;
}

export function createPacket<T>(channel: WSChannel, type: string, payload: T): string {
  try {
    return JSON.stringify({
      channel,
      type,
      payload,
      timestamp: Date.now(),
    });
  } catch {
    const seen = new WeakSet();
    return JSON.stringify(
      {
        channel,
        type,
        payload,
        timestamp: Date.now(),
      },
      (_key, value) => {
        if (typeof value === 'bigint') return value.toString();
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) return '[Circular]';
          seen.add(value);
        }
        return value;
      }
    );
  }
}

export function parsePacket(raw: string): WSPacket | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null; // Malformed frame — callers treat null as "ignore this packet"
  }
}
