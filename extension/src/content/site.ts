// What Charmly needs from a messaging page. WhatsApp has a tuned adapter; every other site uses the generic one.
import type { ChatMessage } from "../shared/types";

export type InsertResult = "ok" | "no-box" | "not-applied";

export interface Site {
  /** "WhatsApp", "Telegram", or the site's host. */
  readonly name: string;
  /** True for the generic adapter: the tray follows whichever message box you're using. */
  readonly generic: boolean;
  /** The open conversation, if there is one to help with. */
  main(): HTMLElement | null;
  /** A stable key for the open chat, used only to keep per-chat state in this browser. */
  chat(): string | null;
  composer(): HTMLElement | null;
  /** Where the tray docks: just above this element. */
  anchor(): HTMLElement | null;
  messages(limit?: number): ChatMessage[];
  /** Changes when a new message arrives; starts with "in:" or "out:". */
  lastKey(): string | null;
  draft(): string;
  insert(text: string): Promise<InsertResult>;
  dark(): boolean;
  health(): { chat: boolean; messages: number; composer: boolean };
}
