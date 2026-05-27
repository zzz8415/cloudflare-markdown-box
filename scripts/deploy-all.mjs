import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

const BOOTSTRAP_CONFIG = "wrangler.bootstrap.toml";

const run = (command, stdio = "inherit") => {
    execSync(command, {
        stdio,
        encoding: "utf8"
    });
};

const hasCommand = (command) => {
    try {
        run(`${command} --version`, "pipe");
        return true;
    } catch {
        return false;
    }
};

const getPackageManager = () => {
    const preferPnpm = existsSync("pnpm-lock.yaml");
    if (preferPnpm && hasCommand("pnpm")) {
        return "pnpm";
    }
    return "npm";
};

const isAuthorized = () => {
    try {
        run(`npx wrangler whoami --config ${BOOTSTRAP_CONFIG}`, "pipe");
        return true;
    } catch {
        return false;
    }
};

const ensureLogin = () => {
    if (isAuthorized()) {
        console.log("已检测到 Wrangler 授权，跳过登录。\n");
        return;
    }

    console.log("未检测到 Wrangler 授权，开始登录流程...\n");
    run(`npx wrangler login --config ${BOOTSTRAP_CONFIG}`);
};

const main = () => {
    ensureLogin();
    const packageManager = getPackageManager();
    console.log(`使用 ${packageManager} 执行安装与发布流程。\n`);

    run(`${packageManager} install`);
    run(`${packageManager} run setup`);
    run(`${packageManager} run deploy`);
};

try {
    main();
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
}
