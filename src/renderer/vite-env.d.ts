/// <reference types="vite/client" />

declare module '*.svg' {
  const src: string;
  export default src;
}

declare module '*.png' {
  const src: string;
  export default src;
}

declare module '@lobehub/ui/awesome' {
  export const GradientButton: any;
}

declare module '@lobehub/ui/chat' {
  export const BackBottom: any;
  export const ChatActionsBar: any;
  export const ChatInputArea: any;
  export const ChatList: any;
  export const TokenTag: any;
  export type ChatMessage = any;
}
