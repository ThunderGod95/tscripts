import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import AdmZip from "adm-zip";
import { mkdir } from "fs/promises";
import { basename, join, sep } from "path";
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
    name: string;
    position: number;
    title: string;
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
    const totalBuildTime = performance.now();
    logger.info(`Starting build...`);

    try {
        if (!existsSync(translationsDir) || !existsSync(assetsDir)) {
            throw new Error(
                `Required directories 'translations' or 'assets' do not exist.`,
            );
        }

        if (!existsSync(distDir)) {
            await mkdir(distDir, { recursive: true });
        }

        await createPdfs(translationsDir, assetsDir, distDir);
        await createEPUBs(translationsDir, assetsDir, distDir);

        const duration = ((performance.now() - totalBuildTime) / 1000).toFixed(2);
        logger.success(`Build completed successfully in ${duration}s ✨`);
    } catch (error) {
        const duration = ((performance.now() - totalBuildTime) / 1000).toFixed(2);
        logger.error(`Build failed after ${duration}s.`);
        console.error(error instanceof Error ? error.message : String(error || ""));
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

async function combineToPDFsOrEPUBs(
    format: "pdf" | "epub",
    translationsDir: string,
    assetsDir: string,
    distDir: string,
) {
    const timer = performance.now();
    const separationInformationPath = join(assetsDir, "sep.json");

    if (!existsSync(separationInformationPath)) {
        logger.warn(
            `'sep.json' not found. Skipping ${format.toUpperCase()} creation.`,
        );
        return;
    }

    const separationInformation: SeparationInformation[] = await Bun.file(
        separationInformationPath,
    ).json();

    logger.task(
        `Creating ${format.toUpperCase()} files... (Total: ${separationInformation.length})`,
    );

    const outputSubDir = join(distDir, `${format}s`);
    if (!existsSync(outputSubDir)) {
        await mkdir(outputSubDir, { recursive: true });
    }

    const creationPromises = separationInformation.map(async (sepInfo) => {
        try {
            const outputPath = join(outputSubDir, `${sepInfo.name}.${format}`);
            const inputFiles: string[] = [];

            for (let i = sepInfo.filestart; i <= sepInfo.fileend; i++) {
                const filePath = join(translationsDir, `${i}.md`);
                if (!existsSync(filePath)) {
                    throw new Error(
                        `Markdown file '${i}.md' does not exist but is required for '${sepInfo.name}'.`,
                    );
                }
                inputFiles.push(filePath);
            }

            if (inputFiles.length === 0) {
                logger.warn(`No input files found for '${sepInfo.name}', skipping.`);
                return;
            }

            logger.info(`  Building '${basename(outputPath)}'...`);

            // --- START: Metadata and Cover Image Logic ---

            const baseTitle = sepInfo.title;
            const author = sepInfo.author;
            const translator = sepInfo.translator;
            const rights = sepInfo.rights;
            const coverImageName = sepInfo.image;

            const coverImagePath = join(assetsDir, coverImageName);
            const normalizedCoverPath = existsSync(coverImagePath)
                ? coverImagePath.replace(/\\/g, "/")
                : null;

            const currentDate = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

            const metadataLines = [
                "---",
                `title: ${baseTitle} (${sepInfo.name})`,
                `author: ${author}`,
                `translator: ${translator}`,
                `date: ${currentDate}`,
                `rights: '${rights}'`,
                "lang: en-US",
                `belongs-to-collection: ${baseTitle}`,
                "collection-type: series",
            ];

            if (sepInfo.position !== undefined) {
                metadataLines.push(`group-position: ${sepInfo.position}`);
            }

            if (normalizedCoverPath) {
                metadataLines.push(`cover-image: ${normalizedCoverPath}`);
            }
            metadataLines.push("---");

            const metadataBlock = metadataLines.join("\n");

            const fileContents = await Promise.all(
                inputFiles.map((path) => Bun.file(path).text()),
            );
            const combinedFileContent = fileContents.join("\n\n----\n\n----\n\n");

            const combinedContent = metadataBlock + "\n\n" + combinedFileContent;

            // --- END: Metadata and Cover Image Logic ---

            const normalizedOutputPath = outputPath.replace(/\\/g, "/");
            const normalizedResourcePath = translationsDir.replace(/\\/g, "/");

            const pandocArgs = [
                "--from",
                "markdown-yaml_metadata_block",
                "--file-scope",
                "--resource-path",
                normalizedResourcePath,
                "-o",
                normalizedOutputPath,
                "--toc",
                ...(format === "pdf" ? ["--pdf-engine=xelatex"] : []),
                ...(format === "epub" && normalizedCoverPath
                    ? [`--epub-cover-image=${normalizedCoverPath}`]
                    : []),
            ];

            const proc = Bun.spawn(["pandoc", ...pandocArgs], {
                stdin: new TextEncoder().encode(combinedContent),
            });

            const exitCode = await proc.exited;
            const stderr = await new Response(proc.stderr).text();

            if (exitCode !== 0) {
                throw new Error(
                    `Pandoc failed for '${basename(outputPath)}' (code ${exitCode}).\nDetails: ${stderr.trim()}`,
                );
            }
        } catch (error) {
            throw new Error(
                `Failed to create '${sepInfo.name}.${format}': ${error instanceof Error ? error.message : String(error)
                }`,
            );
        }
    });

    const results = await Promise.allSettled(creationPromises);
    const failedTasks = results.filter((r) => r.status === "rejected");

    const duration = ((performance.now() - timer) / 1000).toFixed(2);
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

main();