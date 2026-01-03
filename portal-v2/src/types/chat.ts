export type Attachment = { type: 'image'; path: string };
export type AttachmentInput = Attachment;

export type ChatSummary = {
  id: string;
  body: string;
  nickname: string;
  attachments?: Attachment[];
  sourceKind: 'web' | 'slack';
  reaction?: Record<string, number>;
  createdAt: number;
  updatedAt: number;
};

export type ChatDetail = ChatSummary;

export type ChatInsertParams = {
  body: string;
  nickname: string;
  attachments?: AttachmentInput[];
  sourceKind: 'web' | 'slack';
  slack?: { user_id: string; event_id: string };
};
