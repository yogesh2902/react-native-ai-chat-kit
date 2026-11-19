/** A slash command the user can type in the composer, e.g. `/summarize`. */
export type ChatCommand = {
  /** Typed after the slash, e.g. 'summarize'. Letters, numbers and dashes. */
  name: string;
  description?: string;
  /** Emoji shown in the suggestion list. */
  icon?: string;
  /**
   * What's sent to the model. `{input}` is replaced with what the user typed after
   * the command; without `{input}`, their text is added after a blank line.
   */
  prompt?: string | ((input: string) => string);
  /** Run app code instead of sending a message (e.g. `/clear`, `/new`). */
  onRun?: (input: string) => void;
};

/** A message sent through a slash command keeps what the user typed, for display. */
export type CommandReference = { name: string; input: string };

/** Ready-made commands. Pass them (or your own) as `commands` on ChatView. */
export const defaultCommands: ChatCommand[] = [
  { name: 'summarize', icon: '📝', description: 'Summarize text or the chat so far', prompt: 'Summarize this in 3–5 short bullet points:\n\n{input}' },
  { name: 'translate', icon: '🌐', description: 'Translate, e.g. /translate Hindi Good morning', prompt: (input) => translatePrompt(input) },
  { name: 'explain', icon: '💡', description: 'Explain simply, like to a beginner', prompt: 'Explain this simply, like I am a beginner:\n\n{input}' },
  { name: 'fix', icon: '✍️', description: 'Fix grammar and spelling', prompt: 'Fix the grammar and spelling. Reply with only the corrected text:\n\n{input}' },
  { name: 'shorter', icon: '✂️', description: 'Make text shorter', prompt: 'Rewrite this to be about half as long, keeping the meaning:\n\n{input}' },
];

function translatePrompt(input: string): string {
  const [language, ...rest] = input.trim().split(/\s+/);
  const text = rest.join(' ');
  if (!language) return 'Translate the last message into English.';
  return text ? `Translate this into ${language}. Reply with only the translation:\n\n${text}` : `Translate your last answer into ${language}.`;
}

/** `/summarize some text` → the command and "some text"; anything else → null. */
export function matchCommand(text: string, commands: ChatCommand[] | undefined): { command: ChatCommand; input: string } | null {
  if (!commands?.length) return null;
  const m = /^\/([\w-]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m) return null;
  const command = commands.find((c) => c.name.toLowerCase() === m[1]!.toLowerCase());
  return command ? { command, input: (m[2] ?? '').trim() } : null;
}

/** The full prompt a command sends to the model. */
export function expandCommand(command: ChatCommand, input: string): string {
  const { prompt } = command;
  if (typeof prompt === 'function') return prompt(input).trim();
  if (!prompt) return `/${command.name}${input ? ` ${input}` : ''}`;
  if (prompt.includes('{input}')) return prompt.replace(/\{input\}/g, input || 'the conversation so far').trim();
  return input ? `${prompt}\n\n${input}` : prompt;
}

/** Commands to suggest while the user is typing `/…` (before any space). */
export function suggestCommands(text: string, commands: ChatCommand[] | undefined, max = 6): ChatCommand[] {
  if (!commands?.length) return [];
  const m = /^\/([\w-]*)$/.exec(text);
  if (!m) return [];
  const q = m[1]!.toLowerCase();
  const starts = commands.filter((c) => c.name.toLowerCase().startsWith(q));
  const contains = commands.filter((c) => !starts.includes(c) && c.name.toLowerCase().includes(q));
  return [...starts, ...contains].slice(0, max);
}
