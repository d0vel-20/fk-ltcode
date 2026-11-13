// ProcessingHelper.ts
import fs from "node:fs"
import path from "node:path"
import { ScreenshotHelper } from "./ScreenshotHelper"
import { IProcessingHelperDeps } from "./main"
import * as axios from "axios"
import { app, BrowserWindow, dialog, clipboard } from "electron"
import { OpenAI } from "openai"
import { configHelper } from "./ConfigHelper"
import { retryTransientRequest, requestErrorMessage } from "./RequestRetry"
import { questionPrompt, normalizeAnswer, QuestionAnswer } from "./QuestionAnswer"
import Anthropic from '@anthropic-ai/sdk';

// Interface for Gemini API requests
interface GeminiMessage {
  role: string;
  parts: Array<{
    text?: string;
    inlineData?: {
      mimeType: string;
      data: string;
    }
  }>;
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text: string;
      }>;
    };
    finishReason: string;
  }>;
}
interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: Array<{
    type: 'text' | 'image';
    text?: string;
    source?: {
      type: 'base64';
      media_type: string;
      data: string;
    };
  }>;
}
export class ProcessingHelper {
  private deps: IProcessingHelperDeps
  private screenshotHelper: ScreenshotHelper
  private openaiClient: OpenAI | null = null
  private geminiApiKey: string | null = null
  private anthropicClient: Anthropic | null = null

  // AbortControllers for API requests
  private currentProcessingAbortController: AbortController | null = null
  private currentExtraProcessingAbortController: AbortController | null = null
  private lastQuestionInput: { question: string; images: string[]; audio?: { data: string; mimeType: string } } | null = null

  private getValidGeminiModel(model?: string): string {
    if (!model || model === 'gemini-2.0-flash' || model === 'gemini-1.5-pro' || model === 'gemini-1.5-flash') {
      return 'gemini-3.6-flash';
    }
    return model;
  }

  constructor(deps: IProcessingHelperDeps) {
    this.deps = deps
    this.screenshotHelper = deps.getScreenshotHelper()
    
    // Initialize AI client based on config
    this.initializeAIClient();
    
    // Listen for config changes to re-initialize the AI client
    configHelper.on('config-updated', () => {
      this.initializeAIClient();
    });
  }
  
  /**
   * Initialize or reinitialize the AI client with current config
   */
  private initializeAIClient(): void {
    try {
      const config = configHelper.loadConfig();
      
      if (config.apiProvider === "openai") {
        if (config.apiKey) {
          this.openaiClient = new OpenAI({ 
            apiKey: config.apiKey,
            timeout: 60000, // 60 second timeout
            maxRetries: 2   // Retry up to 2 times
          });
          this.geminiApiKey = null;
          this.anthropicClient = null;
          console.log("OpenAI client initialized successfully");
        } else {
          this.openaiClient = null;
          this.geminiApiKey = null;
          this.anthropicClient = null;
          console.warn("No API key available, OpenAI client not initialized");
        }
      } else if (config.apiProvider === "gemini"){
        // Gemini client initialization
        this.openaiClient = null;
        this.anthropicClient = null;
        if (config.apiKey) {
          this.geminiApiKey = config.apiKey;
          console.log("Gemini API key set successfully");
        } else {
          this.openaiClient = null;
          this.geminiApiKey = null;
          this.anthropicClient = null;
          console.warn("No API key available, Gemini client not initialized");
        }
      } else if (config.apiProvider === "anthropic") {
        // Reset other clients
        this.openaiClient = null;
        this.geminiApiKey = null;
        if (config.apiKey) {
          this.anthropicClient = new Anthropic({
            apiKey: config.apiKey,
            timeout: 60000,
            maxRetries: 2
          });
          console.log("Anthropic client initialized successfully");
        } else {
          this.openaiClient = null;
          this.geminiApiKey = null;
          this.anthropicClient = null;
          console.warn("No API key available, Anthropic client not initialized");
        }
      }
    } catch (error) {
      console.error("Failed to initialize AI client:", error);
      this.openaiClient = null;
      this.geminiApiKey = null;
      this.anthropicClient = null;
    }
  }

  private async waitForInitialization(
    mainWindow: BrowserWindow
  ): Promise<void> {
    let attempts = 0
    const maxAttempts = 50 // 5 seconds total

    while (attempts < maxAttempts) {
      const isInitialized = await mainWindow.webContents.executeJavaScript(
        "window.__IS_INITIALIZED__"
      )
      if (isInitialized) return
      await new Promise((resolve) => setTimeout(resolve, 100))
      attempts++
    }
    throw new Error("App failed to initialize after 5 seconds")
  }

  private async getCredits(): Promise<number> {
    const mainWindow = this.deps.getMainWindow()
    if (!mainWindow) return 999 // Unlimited credits in this version

    try {
      await this.waitForInitialization(mainWindow)
      return 999 // Always return sufficient credits to work
    } catch (error) {
      console.error("Error getting credits:", error)
      return 999 // Unlimited credits as fallback
    }
  }

  private async getLanguage(): Promise<string> {
    try {
      // Get language from config
      const config = configHelper.loadConfig();
      if (config.language) {
        return config.language;
      }
      
      // Fallback to window variable if config doesn't have language
      const mainWindow = this.deps.getMainWindow()
      if (mainWindow) {
        try {
          await this.waitForInitialization(mainWindow)
          const language = await mainWindow.webContents.executeJavaScript(
            "window.__LANGUAGE__"
          )

          if (
            typeof language === "string" &&
            language !== undefined &&
            language !== null
          ) {
            return language;
          }
        } catch (err) {
          console.warn("Could not get language from window", err);
        }
      }
      
      // Default fallback
      return "python";
    } catch (error) {
      console.error("Error getting language:", error)
      return "python"
    }
  }

  public async processScreenshots(): Promise<void> {
    const mainWindow = this.deps.getMainWindow()
    if (!mainWindow) return

    const config = configHelper.loadConfig();
    
    // First verify we have a valid AI client
    if (config.apiProvider === "openai" && !this.openaiClient) {
      this.initializeAIClient();
      
      if (!this.openaiClient) {
        console.error("OpenAI client not initialized");
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.API_KEY_INVALID
        );
        return;
      }
    } else if (config.apiProvider === "gemini" && !this.geminiApiKey) {
      this.initializeAIClient();
      
      if (!this.geminiApiKey) {
        console.error("Gemini API key not initialized");
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.API_KEY_INVALID
        );
        return;
      }
    } else if (config.apiProvider === "anthropic" && !this.anthropicClient) {
      // Add check for Anthropic client
      this.initializeAIClient();
      
      if (!this.anthropicClient) {
        console.error("Anthropic client not initialized");
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.API_KEY_INVALID
        );
        return;
      }
    }

    const view = this.deps.getView()
    console.log("Processing screenshots in view:", view)

    if (view === "queue") {
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_START)
      const screenshotQueue = this.screenshotHelper.getScreenshotQueue()
      console.log("Processing main queue screenshots:", screenshotQueue)
      
      // Check if the queue is empty
      if (!screenshotQueue || screenshotQueue.length === 0) {
        console.log("No screenshots found in queue");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        return;
      }

      // Check that files actually exist
      const existingScreenshots = screenshotQueue.filter(path => fs.existsSync(path));
      if (existingScreenshots.length === 0) {
        console.log("Screenshot files don't exist on disk");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        return;
      }

      const controller = new AbortController()
      try {
        // Initialize AbortController
        this.currentProcessingAbortController = controller
        const { signal } = controller

        const screenshots = await Promise.all(
          existingScreenshots.map(async (path) => {
            try {
              return {
                path,
                preview: await this.screenshotHelper.getImagePreview(path),
                data: fs.readFileSync(path).toString('base64')
              };
            } catch (err) {
              console.error(`Error reading screenshot ${path}:`, err);
              return null;
            }
          })
        )

        // Filter out any nulls from failed screenshots
        const validScreenshots = screenshots.filter(Boolean);
        
        if (validScreenshots.length === 0) {
          throw new Error("Failed to load screenshot data");
        }

        const result = await this.processScreenshotsHelper(validScreenshots, signal)
        if (signal.aborted) return;

        if (!result.success) {
          console.log("Processing failed:", result.error)
          if (result.error?.includes("API Key") || result.error?.includes("OpenAI") || result.error?.includes("Gemini")) {
            mainWindow.webContents.send(
              this.deps.PROCESSING_EVENTS.API_KEY_INVALID
            )
          } else {
            mainWindow.webContents.send(
              this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
              result.error
            )
          }
          // Reset view back to queue on error
          console.log("Resetting view to queue due to error")
          this.deps.setView("queue")
          return
        }

        // Only set view to solutions if processing succeeded
        console.log("Setting view to solutions after successful processing")
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS,
          result.data
        )
        this.deps.setView("solutions")
      } catch (error: any) {
        if (controller.signal.aborted) return;
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
          error
        )
        console.error("Processing error:", error)
        if (axios.isCancel(error)) {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
            "Processing was canceled by the user."
          )
        } else {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
            error.message || "Server error. Please try again."
          )
        }
        // Reset view back to queue on error
        console.log("Resetting view to queue due to error")
        this.deps.setView("queue")
      } finally {
        if (this.currentProcessingAbortController === controller) this.currentProcessingAbortController = null
      }
    } else {
      // view == 'solutions'
      if (this.deps.getProblemInfo()?.type && this.deps.getProblemInfo().type !== "coding") {
        const paths = this.screenshotHelper.getExtraScreenshotQueue().filter(path => fs.existsSync(path));
        if (!paths.length) { mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS); return; }
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_START);
        const controller = new AbortController();
        this.currentExtraProcessingAbortController = controller;
        try {
          const answer = await this.requestQuestionAnswer(`Answer the new questions or follow-up in the screenshots. Previous question: ${this.deps.getProblemInfo().problem_statement}`, paths.map(path => fs.readFileSync(path).toString("base64")), controller.signal);
          this.publishAnswer(answer);
          this.screenshotHelper.clearExtraScreenshotQueue();
        } catch (error: any) { mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, error.message); }
        finally { this.currentExtraProcessingAbortController = null; }
        return;
      }
      const extraScreenshotQueue =
        this.screenshotHelper.getExtraScreenshotQueue()
      console.log("Processing extra queue screenshots:", extraScreenshotQueue)
      
      // Check if the extra queue is empty
      if (!extraScreenshotQueue || extraScreenshotQueue.length === 0) {
        console.log("No extra screenshots found in queue");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        
        return;
      }

      // Check that files actually exist
      const existingExtraScreenshots = extraScreenshotQueue.filter(path => fs.existsSync(path));
      if (existingExtraScreenshots.length === 0) {
        console.log("Extra screenshot files don't exist on disk");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        return;
      }
      
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_START)

      // Initialize AbortController
      this.currentExtraProcessingAbortController = new AbortController()
      const { signal } = this.currentExtraProcessingAbortController

      try {
        // Get all screenshots (both main and extra) for processing
        const allPaths = [
          ...this.screenshotHelper.getScreenshotQueue(),
          ...existingExtraScreenshots
        ];
        
        const screenshots = await Promise.all(
          allPaths.map(async (path) => {
            try {
              if (!fs.existsSync(path)) {
                console.warn(`Screenshot file does not exist: ${path}`);
                return null;
              }
              
              return {
                path,
                preview: await this.screenshotHelper.getImagePreview(path),
                data: fs.readFileSync(path).toString('base64')
              };
            } catch (err) {
              console.error(`Error reading screenshot ${path}:`, err);
              return null;
            }
          })
        )
        
        // Filter out any nulls from failed screenshots
        const validScreenshots = screenshots.filter(Boolean);
        
        if (validScreenshots.length === 0) {
          throw new Error("Failed to load screenshot data for debugging");
        }
        
        console.log(
          "Combined screenshots for processing:",
          validScreenshots.map((s) => s.path)
        )

        const result = await this.processExtraScreenshotsHelper(
          validScreenshots,
          signal
        )

        if (result.success) {
          this.deps.setHasDebugged(true)
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_SUCCESS,
            result.data
          )
        } else {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
            result.error
          )
        }
      } catch (error: any) {
        if (axios.isCancel(error)) {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
            "Extra processing was canceled by the user."
          )
        } else {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
            error.message
          )
        }
      } finally {
        this.currentExtraProcessingAbortController = null
      }
    }
  }

  private cleanJsonString(raw: string): string {
    return raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
  }

  private async requestQuestionAnswer(context: string, images: string[] = [], signal?: AbortSignal, audio?: { data: string; mimeType: string }): Promise<QuestionAnswer> {
    const config = configHelper.loadConfig();
    const prompt = questionPrompt(await this.getLanguage(), context);
    this.initializeAIClient();
    let responseText = "";
    if (config.apiProvider === "openai" && this.openaiClient && !audio) {
      const response = await this.openaiClient.chat.completions.create({
        model: config.solutionModel || "gpt-4o",
        messages: [{ role: "user", content: [
          { type: "text", text: prompt },
          ...images.map(data => ({ type: "image_url" as const, image_url: { url: `data:image/png;base64,${data}` } }))
        ] }], response_format: { type: "json_object" }, temperature: 0.2, max_tokens: 4000
      }, { signal });
      responseText = response.choices[0]?.message.content || "";
    } else if (config.apiProvider === "gemini" && this.geminiApiKey) {
      const parts: any[] = [{ text: prompt }, ...images.map(data => ({ inlineData: { mimeType: "image/png", data } }))];
      if (audio) parts.push({ inlineData: { mimeType: audio.mimeType.split(";")[0], data: audio.data } });
      const response = await retryTransientRequest(() => axios.default.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.getValidGeminiModel(config.solutionModel)}:generateContent`,
        { contents: [{ role: "user", parts }], generationConfig: { temperature: 0.2, maxOutputTokens: 4000, responseMimeType: "application/json" } },
        { signal, timeout: 60000, headers: { "x-goog-api-key": this.geminiApiKey } }
      ), {
        signal,
        onRetry: (attempt, delayMs) => this.deps.getMainWindow()?.webContents.send("processing-status", {
          message: `Gemini is busy. Retrying in ${Math.ceil(delayMs / 1000)}s (attempt ${attempt}/4)...`, progress: 40
        })
      });
      responseText = response.data.candidates?.[0]?.content?.parts?.map((part: any) => part.text || "").join("") || "";
    } else if (config.apiProvider === "anthropic" && this.anthropicClient && !audio) {
      const response = await this.anthropicClient.messages.create({
        model: config.solutionModel || "claude-3-7-sonnet-20250219", max_tokens: 4000,
        messages: [{ role: "user", content: [
          { type: "text", text: prompt },
          ...images.map(data => ({ type: "image" as const, source: { type: "base64" as const, media_type: "image/png" as const, data } }))
        ] }], temperature: 0.2
      }, { signal });
      responseText = response.content.filter(block => block.type === "text").map(block => (block as { text: string }).text).join("\n");
    } else {
      throw new Error(audio ? "Raw audio requires Gemini. Use a typed question or transcript with your selected provider." : "API key not configured. Check your settings.");
    }
    if (!responseText.trim()) throw new Error("The AI returned no answer. Please try again.");
    try { return normalizeAnswer(JSON.parse(this.cleanJsonString(responseText))); }
    catch (error) {
      if (error instanceof SyntaxError) throw new Error("The AI returned an incomplete answer. Please retry your question.");
      throw error;
    }
  }

  private publishAnswer(answer: QuestionAnswer): void {
    this.deps.setProblemInfo({ ...answer, constraints: "", example_input: "", example_output: "" });
    try { clipboard.writeText(answer.code || answer.answer); } catch (error) { console.warn("Could not copy answer:", error); }
    const window = this.deps.getMainWindow();
    window?.webContents.send(this.deps.PROCESSING_EVENTS.PROBLEM_EXTRACTED, this.deps.getProblemInfo());
    window?.webContents.send("processing-status", { message: "Answer ready! Copied to clipboard.", progress: 100 });
    window?.webContents.send(this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS, answer);
  }

  private async processScreenshotsHelper(screenshots: Array<{ path: string; data: string }>, signal: AbortSignal): Promise<{ success: boolean; data?: QuestionAnswer; error?: string }> {
    try {
      this.lastQuestionInput = { question: "Answer the questions in these screenshots.", images: screenshots.map(s => s.data) };
      this.deps.getMainWindow()?.webContents.send("processing-status", { message: "Reading question and preparing an answer...", progress: 30 });
      const answer = await this.requestQuestionAnswer("Answer the questions in these screenshots.", screenshots.map(s => s.data), signal);
      if (signal.aborted) return { success: false, error: "Request cancelled" };
      // The caller publishes SOLUTION_SUCCESS after this helper returns.
      this.deps.setProblemInfo({ ...answer, constraints: "", example_input: "", example_output: "" });
      this.deps.getMainWindow()?.webContents.send(this.deps.PROCESSING_EVENTS.PROBLEM_EXTRACTED, this.deps.getProblemInfo());
      this.screenshotHelper.clearExtraScreenshotQueue();
      try { clipboard.writeText(answer.code || answer.answer); } catch (error) { console.warn("Could not copy answer:", error); }
      return { success: true, data: answer };
    } catch (error: any) {
      return { success: false, error: error.message || "Failed to answer question" };
    }
  }

  private async generateSolutionsHelper(signal: AbortSignal) {
    try {
      const problemInfo = this.deps.getProblemInfo();
      const language = await this.getLanguage();
      const config = configHelper.loadConfig();
      const mainWindow = this.deps.getMainWindow();

      if (!problemInfo) {
        throw new Error("No problem info available");
      }

      // Update progress status
      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Creating optimal solution with detailed explanations...",
          progress: 60
        });
      }

      // Create prompt for solution generation
      const promptText = `
Generate a detailed solution for the following coding problem:

PROBLEM STATEMENT:
${problemInfo.problem_statement}

CONSTRAINTS:
${problemInfo.constraints || "No specific constraints provided."}

EXAMPLE INPUT:
${problemInfo.example_input || "No example input provided."}

EXAMPLE OUTPUT:
${problemInfo.example_output || "No example output provided."}

LANGUAGE: ${language}

I need the response in the following format:
1. Code: A clean, optimized implementation in ${language}
2. Your Thoughts: A list of key insights and reasoning behind your approach
3. Time complexity: O(X) with a detailed explanation (at least 2 sentences)
4. Space complexity: O(X) with a detailed explanation (at least 2 sentences)

For complexity explanations, please be thorough. For example: "Time complexity: O(n) because we iterate through the array only once. This is optimal as we need to examine each element at least once to find the solution." or "Space complexity: O(n) because in the worst case, we store all elements in the hashmap. The additional space scales linearly with the input size."

Your solution should be efficient, well-commented, and handle edge cases.
`;

      let responseContent;
      
      if (config.apiProvider === "openai") {
        // OpenAI processing
        if (!this.openaiClient) {
          return {
            success: false,
            error: "OpenAI API key not configured. Please check your settings."
          };
        }
        
        // Send to OpenAI API
        const solutionResponse = await this.openaiClient.chat.completions.create({
          model: config.solutionModel || "gpt-4o",
          messages: [
            { role: "system", content: "You are an expert coding interview assistant. Provide clear, optimal solutions with detailed explanations." },
            { role: "user", content: promptText }
          ],
          max_tokens: 4000,
          temperature: 0.2
        });

        responseContent = solutionResponse.choices[0].message.content;
      } else if (config.apiProvider === "gemini")  {
        // Gemini processing
        if (!this.geminiApiKey) {
          return {
            success: false,
            error: "Gemini API key not configured. Please check your settings."
          };
        }
        
        try {
          // Create Gemini message structure
          const geminiMessages = [
            {
              role: "user",
              parts: [
                {
                  text: `You are an expert coding interview assistant. Provide a clear, optimal solution with detailed explanations for this problem:\n\n${promptText}`
                }
              ]
            }
          ];

          // Make API request to Gemini
          const geminiModel = this.getValidGeminiModel(config.solutionModel);
          const response = await axios.default.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${this.geminiApiKey}`,
            {
              contents: geminiMessages,
              generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 4000
              }
            },
            { signal }
          );

          const responseData = response.data as GeminiResponse;
          
          if (!responseData.candidates || responseData.candidates.length === 0) {
            throw new Error("Empty response from Gemini API");
          }
          
          responseContent = responseData.candidates[0].content.parts[0].text;
        } catch (error) {
          console.error("Error using Gemini API for solution:", error);
          return {
            success: false,
            error: "Failed to generate solution with Gemini API. Please check your API key or try again later."
          };
        }
      } else if (config.apiProvider === "anthropic") {
        // Anthropic processing
        if (!this.anthropicClient) {
          return {
            success: false,
            error: "Anthropic API key not configured. Please check your settings."
          };
        }
        
        try {
          const messages = [
            {
              role: "user" as const,
              content: [
                {
                  type: "text" as const,
                  text: `You are an expert coding interview assistant. Provide a clear, optimal solution with detailed explanations for this problem:\n\n${promptText}`
                }
              ]
            }
          ];

          // Send to Anthropic API
          const response = await this.anthropicClient.messages.create({
            model: config.solutionModel || "claude-3-7-sonnet-20250219",
            max_tokens: 4000,
            messages: messages,
            temperature: 0.2
          });

          responseContent = (response.content[0] as { type: 'text', text: string }).text;
        } catch (error: any) {
          console.error("Error using Anthropic API for solution:", error);

          // Add specific handling for Claude's limitations
          if (error.status === 429) {
            return {
              success: false,
              error: "Claude API rate limit exceeded. Please wait a few minutes before trying again."
            };
          } else if (error.status === 413 || (error.message && error.message.includes("token"))) {
            return {
              success: false,
              error: "Your screenshots contain too much information for Claude to process. Switch to OpenAI or Gemini in settings which can handle larger inputs."
            };
          }

          return {
            success: false,
            error: "Failed to generate solution with Anthropic API. Please check your API key or try again later."
          };
        }
      }
      
      // Extract parts from the response
      const codeMatch = responseContent.match(/```(?:\w+)?\s*([\s\S]*?)```/);
      const code = codeMatch ? codeMatch[1].trim() : responseContent;
      
      // Extract thoughts, looking for bullet points or numbered lists
      const thoughtsRegex = /(?:Thoughts:|Key Insights:|Reasoning:|Approach:)([\s\S]*?)(?:Time complexity:|$)/i;
      const thoughtsMatch = responseContent.match(thoughtsRegex);
      let thoughts: string[] = [];
      
      if (thoughtsMatch && thoughtsMatch[1]) {
        // Extract bullet points or numbered items
        const bulletPoints = thoughtsMatch[1].match(/(?:^|\n)\s*(?:[-*•]|\d+\.)\s*(.*)/g);
        if (bulletPoints) {
          thoughts = bulletPoints.map(point => 
            point.replace(/^\s*(?:[-*•]|\d+\.)\s*/, '').trim()
          ).filter(Boolean);
        } else {
          // If no bullet points found, split by newlines and filter empty lines
          thoughts = thoughtsMatch[1].split('\n')
            .map((line) => line.trim())
            .filter(Boolean);
        }
      }
      
      // Extract complexity information
      const timeComplexityPattern = /Time complexity:?\s*([^\n]+(?:\n[^\n]+)*?)(?=\n\s*(?:Space complexity|$))/i;
      const spaceComplexityPattern = /Space complexity:?\s*([^\n]+(?:\n[^\n]+)*?)(?=\n\s*(?:[A-Z]|$))/i;
      
      let timeComplexity = "O(n) - Linear time complexity because we only iterate through the array once. Each element is processed exactly one time, and the hashmap lookups are O(1) operations.";
      let spaceComplexity = "O(n) - Linear space complexity because we store elements in the hashmap. In the worst case, we might need to store all elements before finding the solution pair.";
      
      const timeMatch = responseContent.match(timeComplexityPattern);
      if (timeMatch && timeMatch[1]) {
        timeComplexity = timeMatch[1].trim();
        if (!timeComplexity.match(/O\([^)]+\)/i)) {
          timeComplexity = `O(n) - ${timeComplexity}`;
        } else if (!timeComplexity.includes('-') && !timeComplexity.includes('because')) {
          const notationMatch = timeComplexity.match(/O\([^)]+\)/i);
          if (notationMatch) {
            const notation = notationMatch[0];
            const rest = timeComplexity.replace(notation, '').trim();
            timeComplexity = `${notation} - ${rest}`;
          }
        }
      }
      
      const spaceMatch = responseContent.match(spaceComplexityPattern);
      if (spaceMatch && spaceMatch[1]) {
        spaceComplexity = spaceMatch[1].trim();
        if (!spaceComplexity.match(/O\([^)]+\)/i)) {
          spaceComplexity = `O(n) - ${spaceComplexity}`;
        } else if (!spaceComplexity.includes('-') && !spaceComplexity.includes('because')) {
          const notationMatch = spaceComplexity.match(/O\([^)]+\)/i);
          if (notationMatch) {
            const notation = notationMatch[0];
            const rest = spaceComplexity.replace(notation, '').trim();
            spaceComplexity = `${notation} - ${rest}`;
          }
        }
      }

      const formattedResponse = {
        code: code,
        thoughts: thoughts.length > 0 ? thoughts : ["Solution approach based on efficiency and readability"],
        time_complexity: timeComplexity,
        space_complexity: spaceComplexity
      };

      return { success: true, data: formattedResponse };
    } catch (error: any) {
      if (axios.isCancel(error)) {
        return {
          success: false,
          error: "Processing was canceled by the user."
        };
      }
      
      if (error?.response?.status === 401) {
        return {
          success: false,
          error: "Invalid OpenAI API key. Please check your settings."
        };
      } else if (error?.response?.status === 429) {
        return {
          success: false,
          error: "OpenAI API rate limit exceeded or insufficient credits. Please try again later."
        };
      }
      
      console.error("Solution generation error:", error);
      return { success: false, error: error.message || "Failed to generate solution" };
    }
  }

  private async processExtraScreenshotsHelper(
    screenshots: Array<{ path: string; data: string }>,
    signal: AbortSignal
  ) {
    try {
      const problemInfo = this.deps.getProblemInfo();
      const language = await this.getLanguage();
      const config = configHelper.loadConfig();
      const mainWindow = this.deps.getMainWindow();

      if (!problemInfo) {
        throw new Error("No problem info available");
      }

      // Update progress status
      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Processing debug screenshots...",
          progress: 30
        });
      }

      // Prepare the images for the API call
      const imageDataList = screenshots.map(screenshot => screenshot.data);
      
      let debugContent;
      
      if (config.apiProvider === "openai") {
        if (!this.openaiClient) {
          return {
            success: false,
            error: "OpenAI API key not configured. Please check your settings."
          };
        }
        
        const messages = [
          {
            role: "system" as const, 
            content: `You are a coding interview assistant helping debug and improve solutions. Analyze these screenshots which include either error messages, incorrect outputs, or test cases, and provide detailed debugging help.

Your response MUST follow this exact structure with these section headers (use ### for headers):
### Issues Identified
- List each issue as a bullet point with clear explanation

### Specific Improvements and Corrections
- List specific code changes needed as bullet points

### Optimizations
- List any performance optimizations if applicable

### Explanation of Changes Needed
Here provide a clear explanation of why the changes are needed

### Key Points
- Summary bullet points of the most important takeaways

If you include code examples, use proper markdown code blocks with language specification (e.g. \`\`\`java).`
          },
          {
            role: "user" as const,
            content: [
              {
                type: "text" as const, 
                text: `I'm solving this coding problem: "${problemInfo.problem_statement}" in ${language}. I need help with debugging or improving my solution. Here are screenshots of my code, the errors or test cases. Please provide a detailed analysis with:
1. What issues you found in my code
2. Specific improvements and corrections
3. Any optimizations that would make the solution better
4. A clear explanation of the changes needed` 
              },
              ...imageDataList.map(data => ({
                type: "image_url" as const,
                image_url: { url: `data:image/png;base64,${data}` }
              }))
            ]
          }
        ];

        if (mainWindow) {
          mainWindow.webContents.send("processing-status", {
            message: "Analyzing code and generating debug feedback...",
            progress: 60
          });
        }

        const debugResponse = await this.openaiClient.chat.completions.create({
          model: config.debuggingModel || "gpt-4o",
          messages: messages,
          max_tokens: 4000,
          temperature: 0.2
        });
        
        debugContent = debugResponse.choices[0].message.content;
      } else if (config.apiProvider === "gemini")  {
        if (!this.geminiApiKey) {
          return {
            success: false,
            error: "Gemini API key not configured. Please check your settings."
          };
        }
        
        try {
          const debugPrompt = `
You are a coding interview assistant helping debug and improve solutions. Analyze these screenshots which include either error messages, incorrect outputs, or test cases, and provide detailed debugging help.

I'm solving this coding problem: "${problemInfo.problem_statement}" in ${language}. I need help with debugging or improving my solution.

YOUR RESPONSE MUST FOLLOW THIS EXACT STRUCTURE WITH THESE SECTION HEADERS:
### Issues Identified
- List each issue as a bullet point with clear explanation

### Specific Improvements and Corrections
- List specific code changes needed as bullet points

### Optimizations
- List any performance optimizations if applicable

### Explanation of Changes Needed
Here provide a clear explanation of why the changes are needed

### Key Points
- Summary bullet points of the most important takeaways

If you include code examples, use proper markdown code blocks with language specification (e.g. \`\`\`java).
`;

          const geminiMessages = [
            {
              role: "user",
              parts: [
                { text: debugPrompt },
                ...imageDataList.map(data => ({
                  inlineData: {
                    mimeType: "image/png",
                    data: data
                  }
                }))
              ]
            }
          ];

          if (mainWindow) {
            mainWindow.webContents.send("processing-status", {
              message: "Analyzing code and generating debug feedback with Gemini...",
              progress: 60
            });
          }

          const geminiModel = this.getValidGeminiModel(config.debuggingModel);
          const response = await axios.default.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${this.geminiApiKey}`,
            {
              contents: geminiMessages,
              generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 4000
              }
            },
            { signal }
          );

          const responseData = response.data as GeminiResponse;
          
          if (!responseData.candidates || responseData.candidates.length === 0) {
            throw new Error("Empty response from Gemini API");
          }
          
          debugContent = responseData.candidates[0].content.parts[0].text;
        } catch (error) {
          console.error("Error using Gemini API for debugging:", error);
          return {
            success: false,
            error: "Failed to process debug request with Gemini API. Please check your API key or try again later."
          };
        }
      } else if (config.apiProvider === "anthropic") {
        if (!this.anthropicClient) {
          return {
            success: false,
            error: "Anthropic API key not configured. Please check your settings."
          };
        }
        
        try {
          const debugPrompt = `
You are a coding interview assistant helping debug and improve solutions. Analyze these screenshots which include either error messages, incorrect outputs, or test cases, and provide detailed debugging help.

I'm solving this coding problem: "${problemInfo.problem_statement}" in ${language}. I need help with debugging or improving my solution.

YOUR RESPONSE MUST FOLLOW THIS EXACT STRUCTURE WITH THESE SECTION HEADERS:
### Issues Identified
- List each issue as a bullet point with clear explanation

### Specific Improvements and Corrections
- List specific code changes needed as bullet points

### Optimizations
- List any performance optimizations if applicable

### Explanation of Changes Needed
Here provide a clear explanation of why the changes are needed

### Key Points
- Summary bullet points of the most important takeaways

If you include code examples, use proper markdown code blocks with language specification.
`;

          const messages = [
            {
              role: "user" as const,
              content: [
                {
                  type: "text" as const,
                  text: debugPrompt
                },
                ...imageDataList.map(data => ({
                  type: "image" as const,
                  source: {
                    type: "base64" as const,
                    media_type: "image/png" as const, 
                    data: data
                  }
                }))
              ]
            }
          ];

          if (mainWindow) {
            mainWindow.webContents.send("processing-status", {
              message: "Analyzing code and generating debug feedback with Claude...",
              progress: 60
            });
          }

          const response = await this.anthropicClient.messages.create({
            model: config.debuggingModel || "claude-3-7-sonnet-20250219",
            max_tokens: 4000,
            messages: messages,
            temperature: 0.2
          });
          
          debugContent = (response.content[0] as { type: 'text', text: string }).text;
        } catch (error: any) {
          console.error("Error using Anthropic API for debugging:", error);
          
          // Add specific handling for Claude's limitations
          if (error.status === 429) {
            return {
              success: false,
              error: "Claude API rate limit exceeded. Please wait a few minutes before trying again."
            };
          } else if (error.status === 413 || (error.message && error.message.includes("token"))) {
            return {
              success: false,
              error: "Your screenshots contain too much information for Claude to process. Switch to OpenAI or Gemini in settings which can handle larger inputs."
            };
          }
          
          return {
            success: false,
            error: "Failed to process debug request with Anthropic API. Please check your API key or try again later."
          };
        }
      }
      
      
      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Debug analysis complete",
          progress: 100
        });
      }

      let extractedCode = "// Debug mode - see analysis below";
      const codeMatch = debugContent.match(/```(?:[a-zA-Z]+)?([\s\S]*?)```/);
      if (codeMatch && codeMatch[1]) {
        extractedCode = codeMatch[1].trim();
      }

      let formattedDebugContent = debugContent;
      
      if (!debugContent.includes('# ') && !debugContent.includes('## ')) {
        formattedDebugContent = debugContent
          .replace(/issues identified|problems found|bugs found/i, '## Issues Identified')
          .replace(/code improvements|improvements|suggested changes/i, '## Code Improvements')
          .replace(/optimizations|performance improvements/i, '## Optimizations')
          .replace(/explanation|detailed analysis/i, '## Explanation');
      }

      const bulletPoints = formattedDebugContent.match(/(?:^|\n)[ ]*(?:[-*•]|\d+\.)[ ]+([^\n]+)/g);
      const thoughts = bulletPoints 
        ? bulletPoints.map(point => point.replace(/^[ ]*(?:[-*•]|\d+\.)[ ]+/, '').trim()).slice(0, 5)
        : ["Debug analysis based on your screenshots"];
      
      const response = {
        code: extractedCode,
        debug_analysis: formattedDebugContent,
        thoughts: thoughts,
        time_complexity: "N/A - Debug mode",
        space_complexity: "N/A - Debug mode"
      };

      return { success: true, data: response };
    } catch (error: any) {
      console.error("Debug processing error:", error);
      return { success: false, error: error.message || "Failed to process debug request" };
    }
  }

  public cancelOngoingRequests(resetContext = true): void {
    let wasCancelled = false

    if (this.currentProcessingAbortController) {
      this.currentProcessingAbortController.abort()
      this.currentProcessingAbortController = null
      wasCancelled = true
    }

    if (this.currentExtraProcessingAbortController) {
      this.currentExtraProcessingAbortController.abort()
      this.currentExtraProcessingAbortController = null
      wasCancelled = true
    }

    this.deps.setHasDebugged(false)

    if (resetContext) {
      this.deps.setProblemInfo(null)
      this.lastQuestionInput = null
    }

    const mainWindow = this.deps.getMainWindow()
    if (resetContext && wasCancelled && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS)
    }
  }

  public async generateAlternativeSolution(): Promise<void> {
    const mainWindow = this.deps.getMainWindow();
    if (!mainWindow) return;

    const problemInfo = this.deps.getProblemInfo();
    if (!problemInfo) {
      console.warn("Cannot generate alternative solution without problem info");
      return;
    }

    if (problemInfo.type && problemInfo.type !== "coding") {
      await this.processAudioQuestion(`Give an alternative explanation or approach to this question: ${problemInfo.problem_statement}. Previous answer: ${problemInfo.answer || ""}`);
      return;
    }
    try {
      const language = await this.getLanguage();
      const config = configHelper.loadConfig();

      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_START);
      mainWindow.webContents.send("processing-status", {
        message: "🔄 Generating alternative optimal approach...",
        progress: 40
      });

      const altPrompt = `Given the following coding problem:
PROBLEM STATEMENT:
${problemInfo.problem_statement}

CONSTRAINTS:
${problemInfo.constraints || "Standard constraints"}

PREFERRED LANGUAGE: ${language}

Generate a completely DIFFERENT ALTERNATIVE solution (e.g. Iterative if previously recursive, Space-Optimized O(1), Binary Search / Two-Pointer, or Dynamic Programming / Bit Manipulation).

Return ONLY a valid JSON object matching:
{
  "time_complexity": "O(...) - Time complexity with brief explanation",
  "space_complexity": "O(...) - Space complexity with brief explanation",
  "thoughts": [
    "Alternative Paradigm: Description of the alternative strategy",
    "Trade-offs vs Primary Approach: Pros/cons compared to standard solution",
    "Edge Cases Handled: Specific edge cases guarded"
  ],
  "code": "Clean, optimal implementation in ${language} with natural candidate-like variable names and inline comments."
}

Return raw JSON only, without markdown code block backticks around the JSON.`;

      let parsed: any = null;

      if (config.apiProvider === "openai" && this.openaiClient) {
        const response = await this.openaiClient.chat.completions.create({
          model: config.solutionModel || "gpt-4o",
          messages: [
            { role: "system", content: "You are an expert technical interview candidate." },
            { role: "user", content: altPrompt }
          ],
          response_format: { type: "json_object" }
        });
        parsed = JSON.parse(this.cleanJsonString(response.choices[0].message.content || "{}"));
      } else if (config.apiProvider === "gemini" && this.geminiApiKey) {
        const geminiModel = this.getValidGeminiModel(config.solutionModel);
        const response = await axios.default.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${this.geminiApiKey}`,
          {
            contents: [{ role: "user", parts: [{ text: altPrompt }] }],
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: 4000,
              responseMimeType: "application/json"
            }
          }
        );
        const text = response.data.candidates[0].content.parts[0].text;
        parsed = JSON.parse(this.cleanJsonString(text));
      } else if (config.apiProvider === "anthropic" && this.anthropicClient) {
        const response = await this.anthropicClient.messages.create({
          model: config.solutionModel || "claude-3-7-sonnet-20250219",
          max_tokens: 4000,
          messages: [{ role: "user", content: altPrompt }]
        });
        const text = (response.content[0] as { type: 'text', text: string }).text;
        parsed = JSON.parse(this.cleanJsonString(text));
      }

      if (parsed) {
        let code = parsed.code || "";
        const codeMatch = code.match(/```(?:\w+)?\s*([\s\S]*?)```/);
        if (codeMatch) code = codeMatch[1].trim();

        const solutionData = {
          code,
          thoughts: Array.isArray(parsed.thoughts) ? parsed.thoughts : [parsed.thoughts || "Alternative approach"],
          time_complexity: parsed.time_complexity || "O(N)",
          space_complexity: parsed.space_complexity || "O(1)"
        };

        if (solutionData.code) {
          try {
            clipboard.writeText(solutionData.code);
            console.log("⚡ Auto-copied alternative solution code to clipboard");
          } catch (e) {
            console.warn("Could not copy to clipboard:", e);
          }
        }

        mainWindow.webContents.send("processing-status", {
          message: "🔄 Alternative solution ready! Copied to clipboard.",
          progress: 100
        });

        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS, solutionData);
      }
    } catch (err: any) {
      console.error("Error generating alternative solution:", err);
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, err.message || "Failed to generate alternative solution");
    }
  }

  public copySolutionCodeToClipboard(code?: string): void {
    const mainWindow = this.deps.getMainWindow();
    if (code) {
      try {
        clipboard.writeText(code);
        if (mainWindow) {
          mainWindow.webContents.send("processing-status", {
            message: "📋 Solution code copied to clipboard!",
            progress: 100
          });
        }
      } catch (e) {
        console.warn("Failed to copy code to clipboard:", e);
      }
    }
  }

  /**
   * Process a voice question transcribed from the live audio stream
   */
  public async processAudioQuestion(transcript: string): Promise<void> {
    await this.processQuestionInput(transcript);
  }

  public async processAudioDirect(audioBase64: string, mimeType = "audio/webm"): Promise<void> {
    await this.processQuestionInput("Transcribe and answer the questions in this audio.", { data: audioBase64, mimeType });
  }

  public async regenerateForLanguage(): Promise<void> {
    const problem = this.deps.getProblemInfo();
    // Saving a preference before a question exists must not submit an empty request.
    if (!this.lastQuestionInput && !problem) return;
    const input = this.lastQuestionInput || {
      question: `Answer this question: ${JSON.stringify(problem)}`, images: []
    };
    await this.processQuestionInput(input.question, input.audio, input.images);
  }

  private async processQuestionInput(question: string, audio?: { data: string; mimeType: string }, suppliedImages?: string[]): Promise<void> {
    const window = this.deps.getMainWindow();
    if (!window) return;
    if (typeof question !== "string" || !question.trim() || (audio && !audio.data)) throw new Error("Please provide a question.");
    let images = suppliedImages || [];
    if (suppliedImages === undefined && !audio) {
      const paths = [...new Set([
        ...this.screenshotHelper.getScreenshotQueue(),
        ...this.screenshotHelper.getExtraScreenshotQueue()
      ])];
      images = paths.filter(path => fs.existsSync(path)).map(path => fs.readFileSync(path).toString("base64"));
      const previous = this.deps.getProblemInfo();
      question = `Use the attached screenshots as the source material for the user's request. A short request such as "fix" refers to the problem or code in the screenshots or previous answer. Read the screenshots before answering. New screenshots and the latest user request take priority over previous context.
${previous ? `Previous question and answer: ${JSON.stringify(previous)}` : ""}
Latest user request: ${question}`;
    }
    this.cancelOngoingRequests(false);
    this.lastQuestionInput = { question, images, audio };
    const controller = new AbortController();
    this.currentProcessingAbortController = controller;
    this.deps.setView("solutions");
    window.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_START);
    try {
      const context = suppliedImages !== undefined
        ? `${question}\nLatest user request: Regenerate the answer. If code is required, rewrite it in ${configHelper.loadConfig().language}, the newly selected programming language.`
        : question;
      const answer = await this.requestQuestionAnswer(context, images, controller.signal, audio);
      if (controller.signal.aborted) return;
      this.publishAnswer(answer);
    } catch (error: any) {
      if (controller.signal.aborted) return;
      const provider = configHelper.loadConfig().apiProvider;
      const message = requestErrorMessage(error, provider === "gemini" ? "Gemini" : provider === "openai" ? "OpenAI" : "Anthropic");
      window.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, message);
      throw new Error(message);
    } finally {
      if (this.currentProcessingAbortController === controller) this.currentProcessingAbortController = null;
    }
  }
}
