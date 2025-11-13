import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { mkdir } from "fs/promises";
import { basename, join } from "path";
import { existsSync } from "fs";

const colors = {
    reset: "\x1b[0m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    cyan: "\x1b[36m",
};

const logger = {
    info: (message: string) =>
        console.log(`${colors.blue}ℹ ${message}${colors.reset}`),
    success: (message: string) =>
        console.log(`${colors.green}✅ ${message}${colors.reset}`),
    warn: (message: string) =>
        console.warn(`${colors.yellow}⚠️ ${message}${colors.reset}`),
    error: (message: string) =>
        console.error(`${colors.red}❌ ${message}${colors.reset}`),
    log: (message: string) => console.log(message),
    task: (message: string) =>
        console.log(`\n${colors.cyan}🚀 ${message}${colors.reset}`),
};

interface SeparationInformation {
    filestart: number;
    fileend: number;
    title: string;
    position: number;
    series: string;
    author: string;
    translator: string;
    rights: string;
    image: string;
}

async function main() {
    const argv = await yargs(hideBin(process.argv))
        .option("translations-dir", {
            type: "string",
            description: "Path to the translations directory",
            demandOption: true,
        })
        .option("assets-dir", {
            type: "string",
            description: "Path to the assets directory",
            demandOption: true,
        })
        .option("dist-dir", {
            type: "string",
            description: "Path to the output distribution directory",
            demandOption: true,
        })
        .help()
        .alias("help", "h")
        .parse();

    const { translationsDir, assetsDir, distDir } = argv;

    logger.info("Starting build...");

    const totalBuildTime = performance.now();

    const results = await Promise.allSettled([
        createPdfs(translationsDir, assetsDir, distDir),
        createEPUBs(translationsDir, assetsDir, distDir)
    ]);

    const pdfResult = results[0];
    const epubResult = results[1];

    if (pdfResult.status === 'rejected') {
        logger.error('PDF creation failed.');
        console.error(pdfResult.reason);
    }
    if (epubResult.status === 'rejected') {
        logger.error('EPUB creation failed.');
        console.error(epubResult.reason);
    }

    const duration = ((performance.now() - totalBuildTime) / 1000).toFixed(2);
    if (results.every(r => r.status === 'fulfilled')) {
        logger.success(`Build completed successfully in ${duration}s ✨`);
    } else {
        logger.error(`Build finished with errors in ${duration}s.`);
        process.exit(1);
    }
}

async function createEPUBs(
    translationsDir: string,
    assetsDir: string,
    distDir: string,
) {
    await combineToPDFsOrEPUBs("epub", translationsDir, assetsDir, distDir);
}

async function createPdfs(
    translationsDir: string,
    assetsDir: string,
    distDir: string,
) {
    await combineToPDFsOrEPUBs("pdf", translationsDir, assetsDir, distDir);
}


type BookFormat = "pdf" | "epub";

interface PandocMetadata {
    metadataArgs: string[];
    normalizedCoverPath: string | null;
}

function normalizePath(path: string): string {
    return path.replace(/\\/g, "/");
}

async function loadSeparationInfo(
    assetsDir: string,
    format: BookFormat,
): Promise<SeparationInformation[] | null> {
    const separationInformationPath = join(assetsDir, "sep.json");

    if (!existsSync(separationInformationPath)) {
        logger.warn(
            `'sep.json' not found. Skipping ${format.toUpperCase()} creation.`,
        );
        return null;
    }
    return Bun.file(separationInformationPath).json();
}
async function prepareOutputDirectory(
    distDir: string,
    format: BookFormat,
): Promise<string> {
    const outputSubDir = join(distDir, `${format}`);
    if (!existsSync(outputSubDir)) {
        await mkdir(outputSubDir, { recursive: true });
    }
    return outputSubDir;
}

function buildInputFileList(
    sepInfo: SeparationInformation,
    translationsDir: string,
): string[] {
    const inputFiles: string[] = [];
    for (let i = sepInfo.filestart; i <= sepInfo.fileend; i++) {
        const filePath = join(translationsDir, `${i}.md`);
        if (!existsSync(filePath)) {
            throw new Error(
                `Markdown file '${i}.md' does not exist but is required for '${sepInfo.title}'.`,
            );
        }
        inputFiles.push(filePath);
    }

    if (inputFiles.length === 0) {
        logger.warn(`No input files found for '${sepInfo.title}', skipping.`);
    }
    return inputFiles;
}

function buildPandocMetadata(
    sepInfo: SeparationInformation,
    assetsDir: string,
    format: BookFormat
): PandocMetadata {
    const coverImagePath = join(assetsDir, sepInfo.image);
    const normalizedCoverPath = existsSync(coverImagePath)
        ? normalizePath(coverImagePath)
        : null;

    const currentDate = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

    const metadataArgs = [
        `--metadata=title:${sepInfo.title}`,
        `--metadata=creator:${sepInfo.author}`,
        `--metadata=translator:${sepInfo.translator}`,
        `--metadata=date:${currentDate}`,
        `--metadata=rights:${sepInfo.rights}`,
        `--metadata=lang:en-US`,
        `--metadata=belongs-to-collection:${sepInfo.series}`,
        `--metadata=collection-type:series`,
        `--metadata=publisher:${sepInfo.translator}`,
        `--metadata=pdftitle:${sepInfo.title}`,
        `--metadata=pdfauthor:${sepInfo.author}`
    ];

    if (sepInfo.position !== undefined) {
        metadataArgs.push(`--metadata=group-position:${sepInfo.position}`);
    }

    return { metadataArgs, normalizedCoverPath };
}

async function combineMarkdownContent(
    inputFiles: string[],
    format: BookFormat,
    normalizedCoverPath: string | null,
): Promise<string> {
    const fileContents = await Promise.all(
        inputFiles.map((path) => Bun.file(path).text()),
    );
    const combinedFileContent = fileContents.join("\n\n");

    let contentPrefix = "";
    if (format === "pdf" && normalizedCoverPath) {
        contentPrefix = `![Cover](${normalizedCoverPath})\n\n\\newpage\n\n`;
    }

    return contentPrefix + combinedFileContent;
}

function buildPandocArgs(
    format: BookFormat,
    outputPath: string,
    metadata: PandocMetadata,
    translationsDir: string,
    assetsDir: string,
): string[] {
    const { metadataArgs, normalizedCoverPath } = metadata;

    const pandocArgs = [
        "--from",
        "markdown-yaml_metadata_block",
        ...metadataArgs,
        "--resource-path",
        normalizePath(translationsDir),
        "--resource-path",
        normalizePath(assetsDir),
        "-o",
        normalizePath(outputPath),
        "--toc",
        "--top-level-division=chapter",
        "-V documentclass=book"
    ];

    if (format === "pdf") {
        pandocArgs.push("--pdf-engine=xelatex");
        pandocArgs.push("--variable=fontsize:12pt");
        pandocArgs.push("--variable=geometry:margin=1.2in");
        pandocArgs.push("--variable=mainfont:Bookerly");
        pandocArgs.push("--variable=classoption:openany");
        pandocArgs.push("--variable=linestretch:1.25");
    }

    if (format === "epub" && normalizedCoverPath) {
        pandocArgs.push(`--epub-cover-image=${normalizedCoverPath}`);
    }

    return pandocArgs;
}

async function runPandoc(
    pandocArgs: string[],
    combinedContent: string,
    outputPath: string,
) {
    const proc = Bun.spawn(["pandoc", ...pandocArgs], {
        stdin: new TextEncoder().encode(combinedContent),
    });

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
        const stderr = await new Response(proc.stderr).text();
        throw new Error(
            `Pandoc failed for '${basename(outputPath)}' (code ${exitCode}).\nDetails: ${stderr.trim()}`,
        );
    }
}

async function processSeparationItem(
    sepInfo: SeparationInformation,
    format: BookFormat,
    translationsDir: string,
    assetsDir: string,
    outputSubDir: string,
) {
    try {
        const safeFileName = sepInfo.title.replace(/[\\/:*?"<>|]/g, "-");
        const outputPath = join(outputSubDir, `${safeFileName}.${format}`);

        // 1. Get and validate input files
        const inputFiles = buildInputFileList(sepInfo, translationsDir);
        if (inputFiles.length === 0) return; // Already warned in buildInputFileList

        logger.info(`  Building '${basename(outputPath)}'...`);

        const metadata = buildPandocMetadata(sepInfo, assetsDir, format);

        const combinedContent = await combineMarkdownContent(
            inputFiles,
            format,
            metadata.normalizedCoverPath,
        );

        const pandocArgs = buildPandocArgs(
            format,
            outputPath,
            metadata,
            translationsDir,
            assetsDir,
        );

        await runPandoc(pandocArgs, combinedContent, outputPath);
    } catch (error) {
        throw new Error(
            `Failed to create '${sepInfo.title}.${format}': ${error instanceof Error ? error.message : String(error)
            }`,
        );
    }
}

function reportResults(
    results: PromiseSettledResult<unknown>[],
    timerStart: number,
    format: BookFormat,
) {
    const failedTasks = results.filter((r) => r.status === "rejected");
    const duration = ((performance.now() - timerStart) / 1000).toFixed(2);

    if (failedTasks.length > 0) {
        failedTasks.forEach((task) => {
            const reason = (task as PromiseRejectedResult).reason;
            logger.error(reason instanceof Error ? reason.message : String(reason));
        });
        throw new Error(
            `${failedTasks.length} ${format.toUpperCase()} creation task(s) failed.`,
        );
    } else {
        logger.success(
            `All ${format.toUpperCase()} files created successfully in ${duration}s.`,
        );
    }
}

async function combineToPDFsOrEPUBs(
    format: BookFormat,
    translationsDir: string,
    assetsDir: string,
    distDir: string,
) {
    const timer = performance.now();

    const separationInformation = await loadSeparationInfo(assetsDir, format);
    if (!separationInformation) return;

    logger.task(
        `Creating ${format.toUpperCase()} files... (Total: ${separationInformation.length})`,
    );

    const outputSubDir = await prepareOutputDirectory(distDir, format);

    const creationPromises = separationInformation.map((sepInfo) =>
        processSeparationItem(
            sepInfo,
            format,
            translationsDir,
            assetsDir,
            outputSubDir,
        ),
    );

    const results = await Promise.allSettled(creationPromises);

    reportResults(results, timer, format);
}

main();