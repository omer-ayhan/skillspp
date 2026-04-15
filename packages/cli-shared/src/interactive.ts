import { runTextInputScreen, PromptCancelledError } from "./ui/screens";

export { PromptCancelledError };

export function isPromptCancelledError(error: unknown): boolean {
  return error instanceof PromptCancelledError;
}

export function canUseInteractive(nonInteractive?: boolean): boolean {
  if (nonInteractive) {
    return false;
  }

  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function mapPromptError(error: unknown): never {
  if (error instanceof Error && error.name === "ExitPromptError") {
    throw new PromptCancelledError();
  }
  throw error;
}

export async function askText(
  message: string,
  defaultValue?: string
): Promise<string> {
  try {
    return await runTextInputScreen({
      message,
      defaultValue,
    });
  } catch (error) {
    mapPromptError(error);
  }
}
