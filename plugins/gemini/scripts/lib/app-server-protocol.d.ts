declare module "./app-server-protocol" {
  // Minimal local protocol types for the Gemini compatibility runtime.
  // The checked-in runtime only needs these shapes for editor/type-check support.
  // We keep them local so `npm run build` does not depend on a Gemini CLI codegen
  // command that is no longer available in current Gemini CLI releases.

  export interface ClientInfo {
    title?: string;
    name?: string;
    version?: string;
    [key: string]: unknown;
  }

  export interface InitializeCapabilities {
    experimentalApi?: boolean;
    optOutNotificationMethods?: string[];
    [key: string]: unknown;
  }

  export interface InitializeParams {
    clientInfo?: ClientInfo;
    capabilities?: InitializeCapabilities;
    [key: string]: unknown;
  }

  export interface InitializeResponse {
    [key: string]: unknown;
  }

  export interface ReviewTarget {
    type?: string;
    branch?: string;
    [key: string]: unknown;
  }

  export interface UserInput {
    type?: string;
    text?: string;
    [key: string]: unknown;
  }

  export interface ThreadItem {
    id?: string;
    role?: string;
    text?: string;
    [key: string]: unknown;
  }

  export interface Thread {
    id?: string;
    name?: string | null;
    items?: ThreadItem[];
    [key: string]: unknown;
  }

  export interface ThreadListParams {
    cursor?: string | null;
    limit?: number;
    [key: string]: unknown;
  }

  export interface ThreadListResponse {
    threads?: Thread[];
    nextCursor?: string | null;
    [key: string]: unknown;
  }

  export interface ThreadStartParams {
    items?: UserInput[];
    model?: string | null;
    sandbox?: string | null;
    cwd?: string;
    threadName?: string | null;
    persistHistory?: boolean;
    [key: string]: unknown;
  }

  export interface ThreadStartResponse {
    threadId?: string | null;
    thread?: Thread;
    [key: string]: unknown;
  }

  export interface ThreadResumeParams {
    threadId?: string | null;
    items?: UserInput[];
    model?: string | null;
    sandbox?: string | null;
    cwd?: string;
    [key: string]: unknown;
  }

  export interface ThreadResumeResponse {
    threadId?: string | null;
    thread?: Thread;
    [key: string]: unknown;
  }

  export interface ThreadSetNameParams {
    threadId?: string | null;
    name?: string | null;
    [key: string]: unknown;
  }

  export interface ThreadSetNameResponse {
    threadId?: string | null;
    [key: string]: unknown;
  }

  export interface ReviewStartParams {
    target?: ReviewTarget;
    model?: string | null;
    cwd?: string;
    [key: string]: unknown;
  }

  export interface ReviewStartResponse {
    threadId?: string | null;
    turnId?: string | null;
    reviewText?: string;
    [key: string]: unknown;
  }

  export interface Turn {
    id?: string;
    status?: string;
    [key: string]: unknown;
  }

  export interface TurnStartParams {
    prompt?: string;
    model?: string | null;
    sandbox?: string | null;
    cwd?: string;
    items?: UserInput[];
    outputSchema?: unknown;
    [key: string]: unknown;
  }

  export interface TurnStartResponse {
    threadId?: string | null;
    turnId?: string | null;
    [key: string]: unknown;
  }

  export interface TurnInterruptParams {
    threadId?: string | null;
    turnId?: string | null;
    [key: string]: unknown;
  }

  export interface TurnInterruptResponse {
    interrupted?: boolean;
    [key: string]: unknown;
  }

  export interface ServerNotification {
    method: string;
    params?: Record<string, unknown>;
    [key: string]: unknown;
  }

  export interface AppServerClientOptions {
    env?: NodeJS.ProcessEnv;
    clientInfo?: ClientInfo;
    capabilities?: InitializeCapabilities;
    brokerEndpoint?: string;
    disableBroker?: boolean;
  }

  export interface GeminiAppServerClientOptions extends AppServerClientOptions {}

  export interface AppServerMethodMap {
    initialize: { params: InitializeParams; result: InitializeResponse };
    "thread/start": { params: ThreadStartParams; result: ThreadStartResponse };
    "thread/resume": {
      params: ThreadResumeParams;
      result: ThreadResumeResponse;
    };
    "thread/name/set": {
      params: ThreadSetNameParams;
      result: ThreadSetNameResponse;
    };
    "thread/list": { params: ThreadListParams; result: ThreadListResponse };
    "review/start": { params: ReviewStartParams; result: ReviewStartResponse };
    "turn/start": { params: TurnStartParams; result: TurnStartResponse };
    "turn/interrupt": {
      params: TurnInterruptParams;
      result: TurnInterruptResponse;
    };
  }

  export type AppServerMethod = keyof AppServerMethodMap;
  export type AppServerRequestParams<M extends AppServerMethod> =
    AppServerMethodMap[M]["params"];
  export type AppServerResponse<M extends AppServerMethod> =
    AppServerMethodMap[M]["result"];
  export type AppServerNotification = ServerNotification;
  export type AppServerNotificationHandler = (
    message: AppServerNotification,
  ) => void;
}

export {};
