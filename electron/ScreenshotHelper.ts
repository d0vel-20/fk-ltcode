// ScreenshotHelper.ts

import path from "node:path";
import fs from "node:fs";
import { app, desktopCapturer, screen } from "electron";
import { v4 as uuidv4 } from "uuid";
import { execFile } from "child_process";
import { promisify } from "util";
import screenshot from "screenshot-desktop";
import os from "os";

const execFileAsync = promisify(execFile);

export class ScreenshotHelper {
  private screenshotQueue: string[] = [];
  private extraScreenshotQueue: string[] = [];
  private readonly MAX_SCREENSHOTS = 5;

  private readonly screenshotDir: string;
  private readonly extraScreenshotDir: string;
  private readonly tempDir: string;

  private view: "queue" | "solutions" | "debug" = "queue";

  constructor(view: "queue" | "solutions" | "debug" = "queue") {
    this.view = view;

    // Initialize directories
    this.screenshotDir = path.join(app.getPath("userData"), "screenshots");
    this.extraScreenshotDir = path.join(
      app.getPath("userData"),
      "extra_screenshots"
    );
    this.tempDir = path.join(
      app.getPath("temp"),
      "interview-coder-screenshots"
    );

    // Create directories if they don't exist
    this.ensureDirectoriesExist();

    // Clean existing screenshot directories when starting the app
    this.cleanScreenshotDirectories();
  }

  private ensureDirectoriesExist(): void {
    const directories = [
      this.screenshotDir,
      this.extraScreenshotDir,
      this.tempDir,
    ];

    for (const dir of directories) {
      if (!fs.existsSync(dir)) {
        try {
          fs.mkdirSync(dir, { recursive: true });
          console.log(`Created directory: ${dir}`);
        } catch (err) {
          console.error(`Error creating directory ${dir}:`, err);
        }
      }
    }
  }

  // This method replaces loadExistingScreenshots() to ensure we start with empty queues
  private cleanScreenshotDirectories(): void {
    try {
      // Clean main screenshots directory
      if (fs.existsSync(this.screenshotDir)) {
        const files = fs
          .readdirSync(this.screenshotDir)
          .filter((file) => file.endsWith(".png"))
          .map((file) => path.join(this.screenshotDir, file));

        // Delete each screenshot file
        for (const file of files) {
          try {
            fs.unlinkSync(file);
            console.log(`Deleted existing screenshot: ${file}`);
          } catch (err) {
            console.error(`Error deleting screenshot ${file}:`, err);
          }
        }
      }

      // Clean extra screenshots directory
      if (fs.existsSync(this.extraScreenshotDir)) {
        const files = fs
          .readdirSync(this.extraScreenshotDir)
          .filter((file) => file.endsWith(".png"))
          .map((file) => path.join(this.extraScreenshotDir, file));

        // Delete each screenshot file
        for (const file of files) {
          try {
            fs.unlinkSync(file);
            console.log(`Deleted existing extra screenshot: ${file}`);
          } catch (err) {
            console.error(`Error deleting extra screenshot ${file}:`, err);
          }
        }
      }

      console.log("Screenshot directories cleaned successfully");
    } catch (err) {
      console.error("Error cleaning screenshot directories:", err);
    }
  }

  public getView(): "queue" | "solutions" | "debug" {
    return this.view;
  }

  public setView(view: "queue" | "solutions" | "debug"): void {
    console.log("Setting view in ScreenshotHelper:", view);
    console.log(
      "Current queues - Main:",
      this.screenshotQueue,
      "Extra:",
      this.extraScreenshotQueue
    );
    this.view = view;
  }

  public getScreenshotQueue(): string[] {
    return this.screenshotQueue;
  }

  public getExtraScreenshotQueue(): string[] {
    console.log("Getting extra screenshot queue:", this.extraScreenshotQueue);
    return this.extraScreenshotQueue;
  }

  public clearQueues(): void {
    // Clear screenshotQueue
    this.screenshotQueue.forEach((screenshotPath) => {
      fs.unlink(screenshotPath, (err) => {
        if (err)
          console.error(`Error deleting screenshot at ${screenshotPath}:`, err);
      });
    });
    this.screenshotQueue = [];

    // Clear extraScreenshotQueue
    this.extraScreenshotQueue.forEach((screenshotPath) => {
      fs.unlink(screenshotPath, (err) => {
        if (err)
          console.error(
            `Error deleting extra screenshot at ${screenshotPath}:`,
            err
          );
      });
    });
    this.extraScreenshotQueue = [];
  }

  private async captureScreenshot(): Promise<Buffer> {
    try {
      // Priority 1: Native Electron desktopCapturer (sub-50ms, in-memory GPU capture across all platforms)
      try {
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width, height } = primaryDisplay.size;
        const sf = primaryDisplay.scaleFactor || 1;
        const sources = await desktopCapturer.getSources({
          types: ["screen"],
          thumbnailSize: {
            width: Math.round(width * sf),
            height: Math.round(height * sf),
          },
        });

        if (sources && sources.length > 0) {
          const buffer = sources[0].thumbnail.toPNG();
          if (buffer && buffer.length > 0) {
            return buffer;
          }
        }
      } catch (capturerError) {
        console.warn("desktopCapturer failed, trying fallback:", capturerError);
      }

      // Priority 2: screenshot-desktop
      try {
        const buffer = await screenshot({ format: "png" });
        if (buffer && buffer.length > 0) {
          return buffer;
        }
      } catch (shotError) {
        console.warn("screenshot-desktop failed:", shotError);
      }

      // Priority 3: Windows PowerShell fallback if on Windows
      if (process.platform === "win32") {
        return await this.captureWindowsScreenshot();
      }

      throw new Error("All screenshot capture mechanisms failed.");
    } catch (error) {
      console.error("Error capturing screenshot:", error);
      throw new Error(`Failed to capture screenshot: ${error.message}`);
    }
  }

  /**
   * Windows-specific screenshot capture fallback
   */
  private async captureWindowsScreenshot(): Promise<Buffer> {
    try {
      const tempFile = path.join(this.tempDir, `ps-temp-${uuidv4()}.png`);
      const psScript = `
      Add-Type -AssemblyName System.Windows.Forms,System.Drawing
      $screens = [System.Windows.Forms.Screen]::AllScreens
      $top = ($screens | ForEach-Object {$_.Bounds.Top} | Measure-Object -Minimum).Minimum
      $left = ($screens | ForEach-Object {$_.Bounds.Left} | Measure-Object -Minimum).Minimum
      $width = ($screens | ForEach-Object {$_.Bounds.Right} | Measure-Object -Maximum).Maximum
      $height = ($screens | ForEach-Object {$_.Bounds.Bottom} | Measure-Object -Maximum).Maximum
      $bounds = [System.Drawing.Rectangle]::FromLTRB($left, $top, $width, $height)
      $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
      $graphics = [System.Drawing.Graphics]::FromImage($bmp)
      $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bounds.Size)
      $bmp.Save('${tempFile.replace(/\\/g, "\\\\")}', [System.Drawing.Imaging.ImageFormat]::Png)
      $graphics.Dispose()
      $bmp.Dispose()
      `;

      await execFileAsync("powershell", [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        psScript,
      ]);

      if (fs.existsSync(tempFile)) {
        const buffer = await fs.promises.readFile(tempFile);
        try {
          await fs.promises.unlink(tempFile);
        } catch {}
        return buffer;
      }
    } catch (err) {
      console.warn("PowerShell fallback failed:", err);
    }
    throw new Error("Windows fallback capture failed.");
  }

  public async takeScreenshot(
    hideMainWindow: () => void,
    showMainWindow: () => void
  ): Promise<string> {
    console.log("Taking instant screenshot in view:", this.view);
    hideMainWindow();

    // Minimal 30ms delay to ensure window manager unmaps frame
    await new Promise((resolve) => setTimeout(resolve, 30));

    let screenshotPath = "";
    try {
      // Get screenshot buffer using cross-platform method
      const screenshotBuffer = await this.captureScreenshot();

      if (!screenshotBuffer || screenshotBuffer.length === 0) {
        throw new Error("Screenshot capture returned empty buffer");
      }

      // Save and manage the screenshot based on current view
      if (this.view === "queue") {
        screenshotPath = path.join(this.screenshotDir, `${uuidv4()}.png`);
        const screenshotDir = path.dirname(screenshotPath);
        if (!fs.existsSync(screenshotDir)) {
          fs.mkdirSync(screenshotDir, { recursive: true });
        }
        await fs.promises.writeFile(screenshotPath, screenshotBuffer);
        console.log("Adding screenshot to main queue:", screenshotPath);
        this.screenshotQueue.push(screenshotPath);
        if (this.screenshotQueue.length > this.MAX_SCREENSHOTS) {
          const removedPath = this.screenshotQueue.shift();
          if (removedPath) {
            try {
              await fs.promises.unlink(removedPath);
              console.log(
                "Removed old screenshot from main queue:",
                removedPath
              );
            } catch (error) {
              console.error("Error removing old screenshot:", error);
            }
          }
        }
      } else {
        // In solutions view, only add to extra queue
        screenshotPath = path.join(this.extraScreenshotDir, `${uuidv4()}.png`);
        const screenshotDir = path.dirname(screenshotPath);
        if (!fs.existsSync(screenshotDir)) {
          fs.mkdirSync(screenshotDir, { recursive: true });
        }
        await fs.promises.writeFile(screenshotPath, screenshotBuffer);
        console.log("Adding screenshot to extra queue:", screenshotPath);
        this.extraScreenshotQueue.push(screenshotPath);
        if (this.extraScreenshotQueue.length > this.MAX_SCREENSHOTS) {
          const removedPath = this.extraScreenshotQueue.shift();
          if (removedPath) {
            try {
              await fs.promises.unlink(removedPath);
              console.log(
                "Removed old screenshot from extra queue:",
                removedPath
              );
            } catch (error) {
              console.error("Error removing old screenshot:", error);
            }
          }
        }
      }
    } catch (error) {
      console.error("Screenshot error:", error);
      throw error;
    } finally {
      // Increased delay for showing window again
      await new Promise((resolve) => setTimeout(resolve, 200));
      showMainWindow();
    }

    return screenshotPath;
  }

  public async getImagePreview(filepath: string): Promise<string> {
    try {
      if (!fs.existsSync(filepath)) {
        console.error(`Image file not found: ${filepath}`);
        return "";
      }

      const data = await fs.promises.readFile(filepath);
      return `data:image/png;base64,${data.toString("base64")}`;
    } catch (error) {
      console.error("Error reading image:", error);
      return "";
    }
  }

  public async deleteScreenshot(
    path: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (fs.existsSync(path)) {
        await fs.promises.unlink(path);
      }

      if (this.view === "queue") {
        this.screenshotQueue = this.screenshotQueue.filter(
          (filePath) => filePath !== path
        );
      } else {
        this.extraScreenshotQueue = this.extraScreenshotQueue.filter(
          (filePath) => filePath !== path
        );
      }
      return { success: true };
    } catch (error) {
      console.error("Error deleting file:", error);
      return { success: false, error: error.message };
    }
  }


  // screenshot queue

  public clearExtraScreenshotQueue(): void {
    // Clear extraScreenshotQueue
    this.extraScreenshotQueue.forEach((screenshotPath) => {
      if (fs.existsSync(screenshotPath)) {
        fs.unlink(screenshotPath, (err) => {
          if (err)
            console.error(
              `Error deleting extra screenshot at ${screenshotPath}:`,
              err
            );
        });
      }
    });
    this.extraScreenshotQueue = [];
  }
}
