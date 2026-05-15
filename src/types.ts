export type TextPart = {
  text: string;
  mediaType?: string;
};

export type Part = TextPart & Record<string, unknown>;

export type Message = {
  role: "ROLE_USER" | "ROLE_AGENT";
  messageId?: string;
  parts: Part[];
  contextId?: string;
  taskId?: string;
};

export type TaskState =
  | "TASK_STATE_WORKING"
  | "TASK_STATE_COMPLETED"
  | "TASK_STATE_FAILED";

export type TaskStatus = {
  state: TaskState;
  message: Message;
  timestamp: string;
};

export type Artifact = {
  name: string;
  parts: Part[];
};

export type Task = {
  id: string;
  contextId?: string;
  status: TaskStatus;
  artifacts: Artifact[];
  history: Message[];
};

export type SecurityScheme = {
  type: "http";
  scheme: "bearer";
  description?: string;
};

export type AgentCard = {
  name: string;
  description: string;
  version: string;
  supportedInterfaces: Array<{
    url: string;
    protocolBinding: "JSONRPC";
    protocolVersion: "1.0";
  }>;
  capabilities: {
    streaming: false;
    pushNotifications: false;
  };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: unknown[];
  securitySchemes?: Record<string, SecurityScheme>;
  security?: Array<Record<string, string[]>>;
};

export type SendMessageParams = {
  message?: {
    role?: unknown;
    messageId?: unknown;
    parts?: unknown;
    contextId?: unknown;
    taskId?: unknown;
  };
  configuration?: unknown;
  metadata?: unknown;
};

export type GetTaskParams = {
  id?: unknown;
  historyLength?: unknown;
};
