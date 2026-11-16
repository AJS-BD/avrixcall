// Minimal typings for the Jitsi Meet IFrame API, loaded from
// https://<NEXT_PUBLIC_JITSI_DOMAIN>/external_api.js at runtime.
// No jitsi npm package is used (one-dependency rule).
export {};

declare global {
  interface JitsiMeetExternalAPIInstance {
    executeCommand: (command: string, ...args: unknown[]) => void;
    addListener: (
      event: string,
      listener: (...args: unknown[]) => void,
    ) => void;
    removeListener: (
      event: string,
      listener: (...args: unknown[]) => void,
    ) => void;
    isAudioMuted: () => Promise<boolean>;
    isVideoMuted: () => Promise<boolean>;
    dispose: () => void;
  }

  interface Window {
    JitsiMeetExternalAPI?: new (
      domain: string,
      options: Record<string, unknown>,
    ) => JitsiMeetExternalAPIInstance;
  }
}
