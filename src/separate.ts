// save as separate.ts
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";

/**
 * Splits combined chapter content from a single file into multiple individual chapter files.
 *
 * Assumes:
 * 1. The source file contains one or more chapters.
 * 2. Each chapter begins with a Markdown H1 header on its own line (e.g., "# Chapter 90 Title").
 * 3. The header contains the chapter number (e.g., "# Chapter 90").
 */
async function separateChapters(
    sourceFolderPath: string,
    sourceFileName: string,
): Promise<void> {
    const sourceFilePath = path.join(sourceFolderPath, sourceFileName);
    console.log(`\nProcessing source file: ${sourceFilePath}`);

    let combinedContent: string;
    try {
        combinedContent = readFileSync(sourceFilePath, "utf-8");
    } catch (error: any) {
        console.error(`❌ ERROR: Could not read source file '${sourceFilePath}'.`);
        console.error(error.message);
        process.exit(1);
    }

    // Split the file content based on lines that start with "# ".
    // This uses a positive lookahead `(?=...)` to split *before* the delimiter,
    // keeping the delimiter in the resulting array block.
    // The `m` flag ensures `^` matches the start of each line.
    const chapterBlocks = combinedContent.split(/(?=^# )/m);

    if (chapterBlocks.length === 0 || chapterBlocks[0].trim() === "") {
        console.warn("⚠️  No chapter content found (or file is empty). Exiting.");
        return;
    }

    console.log(`Found ${chapterBlocks.length} chapter block(s) to separate.`);

    let filesWritten = 0;

    // --- THIS IS THE FIX ---
    // Matches "#", optional space, any non-digit chars, then the number.
    // It will match "# 93 Title", "#93 Title", and "# Chapter 93 Title"
    const chapterNumberRegex = /#\s*.*?(\d+)/;

    for (const block of chapterBlocks) {
        const content = block.trim();
        if (content.length === 0) {
            continue; // Skip any empty blocks (e.g., from initial newlines)
        }

        const firstLine = content.split("\n")[0];
        const match = firstLine.match(chapterNumberRegex);

        if (!match || !match[1]) {
            console.warn(
                `⚠️  Could not find chapter number in header: "${firstLine}". Skipping block.`,
            );
            continue;
        }

        const chapterNumber = match[1];
        const targetFileName = `${chapterNumber}.md`;
        const targetFilePath = path.join(sourceFolderPath, targetFileName);

        try {
            // Write the content to the target file (e.g., 90.md, 91.md, etc.)
            // This will correctly overwrite the source file (e.g., 90.md)
            // with only its own content.
            writeFileSync(targetFilePath, content);
            console.log(`✅ Wrote chapter ${chapterNumber} to ${targetFileName}`);
            filesWritten++;
        } catch (error: any) {
            console.error(
                `❌ ERROR: Failed to write to file '${targetFilePath}'.`,
            );
            console.error(error.message);
        }
    }

    console.log(
        `\n🎉 Separation complete. Wrote content for ${filesWritten} chapter(s).`,
    );
}

async function main() {
    const argv = await yargs(hideBin(process.argv))
        .option("folder", {
            type: "string",
            description: "The absolute path to the translations directory",
            demandOption: true,
        })
        .option("file", {
            type: "string",
            description:
                "The name of the source file containing all chapters (e.g., '90.md')",
            demandOption: true,
        })
        .help()
        .parse();

    try {
        await separateChapters(argv.folder, argv.file);
    } catch (error: any) {
        console.error(`\n--- ❌ AN UNEXPECTED ERROR OCCURRED ---`);
        console.error(error.message);
        process.exit(1);
    }
}

main();