import { tool } from "@opencode-ai/plugin";
import * as fs from "fs";
import * as path from "path";

/**
 * Reads .md, .txt, and .pdf files and returns their text content.
 * For PDF files, text is extracted page by page.
 * Use this tool when the model does not support native file attachments.
 */
export default tool({
  description:
    "Read a .md, .txt, or .pdf file and return its text content. " +
    "Use this when a user uploads or references a file that the model cannot read natively. " +
    "Provide the absolute or workspace-relative file path.",
  args: {
    file_path: tool.schema
      .string()
      .describe("Absolute or workspace-relative path to the .md, .txt, or .pdf file"),
  },
  async execute(args, context) {
    const rawPath = args.file_path.trim();
    const resolved = path.isAbsolute(rawPath)
      ? rawPath
      : path.join(context.directory, rawPath);

    if (!fs.existsSync(resolved)) {
      return `Error: File not found: ${resolved}`;
    }

    const ext = path.extname(resolved).toLowerCase();

    if (ext === ".md" || ext === ".txt") {
      const content = fs.readFileSync(resolved, "utf8");
      return content;
    }

    if (ext === ".pdf") {
      // pdf-parse is installed via ~/.config/opencode/package.json
      try {
        // @ts-ignore - runtime dependency
        const pdfParse = (await import("pdf-parse")).default;
        const buffer = fs.readFileSync(resolved);
        const data = await pdfParse(buffer);
        return data.text;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return (
          `Error: Failed to parse PDF. Make sure pdf-parse is installed.\n` +
          `Add {"dependencies":{"pdf-parse":"^1.1.1"}} to ~/.config/opencode/package.json\n` +
          `Details: ${message}`
        );
      }
    }

    return `Error: Unsupported file type "${ext}". Supported types: .md, .txt, .pdf`;
  },
});
