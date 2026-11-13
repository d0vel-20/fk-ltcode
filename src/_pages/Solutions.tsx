// Solutions.tsx
import React, { useState, useEffect, useRef } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { dracula } from "react-syntax-highlighter/dist/esm/styles/prism"

import ScreenshotQueue from "../components/Queue/ScreenshotQueue"

import type { QuestionAnswer } from "../../electron/QuestionAnswer"
import { ProblemStatementData } from "../types/solutions"
import SolutionCommands from "../components/Solutions/SolutionCommands"
import Debug from "./Debug"
import { useToast } from "../contexts/toast"
import { COMMAND_KEY } from "../utils/platform"

export const ContentSection = ({
  title,
  content,
  isLoading
}: {
  title: string
  content: React.ReactNode
  isLoading: boolean
}) => (
  <div className="space-y-2">
    <h2 className="text-[13px] font-medium text-white tracking-wide">
      {title}
    </h2>
    {isLoading ? (
      <div className="mt-4 flex">
        <p className="text-xs bg-gradient-to-r from-gray-300 via-gray-100 to-gray-300 bg-clip-text text-transparent animate-pulse">
          Extracting problem statement...
        </p>
      </div>
    ) : (
      <div className="text-[13px] leading-[1.4] text-gray-100 max-w-[600px]">
        {content}
      </div>
    )}
  </div>
)

export const ComplexityBadges = ({
  timeComplexity,
  spaceComplexity,
  onAlternativeClick,
  isGeneratingAlt
}: {
  timeComplexity: string | null
  spaceComplexity: string | null
  onAlternativeClick?: () => void
  isGeneratingAlt?: boolean
}) => {
  const formatBrief = (c: string | null, defaultVal: string) => {
    if (!c || c.trim() === "") return defaultVal;
    const match = c.match(/O\([^)]+\)/i);
    return match ? match[0] : `O(${c})`;
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-white/5 border border-white/10 rounded-lg">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2.5 py-1 rounded-md text-xs font-semibold">
          <span className="opacity-70">⏱️ Time:</span>
          <span>{formatBrief(timeComplexity, "O(N)")}</span>
        </div>
        <div className="flex items-center gap-1.5 bg-purple-500/20 text-purple-300 border border-purple-500/40 px-2.5 py-1 rounded-md text-xs font-semibold">
          <span className="opacity-70">💾 Space:</span>
          <span>{formatBrief(spaceComplexity, "O(1)")}</span>
        </div>
      </div>
      {onAlternativeClick && (
        <button
          onClick={onAlternativeClick}
          disabled={isGeneratingAlt}
          className="text-xs flex items-center gap-1.5 text-white/90 bg-white/10 hover:bg-white/20 border border-white/10 px-2.5 py-1 rounded-md transition font-medium disabled:opacity-50"
          title="Generate alternative optimal approach (Ctrl+K)"
        >
          <span>🔄</span>
          <span>{isGeneratingAlt ? "Generating..." : "Alternative (Ctrl+K)"}</span>
        </button>
      )}
    </div>
  );
};

const SolutionSection = ({
  title,
  content,
  isLoading,
  currentLanguage,
  onCopy
}: {
  title: string
  content: React.ReactNode
  isLoading: boolean
  currentLanguage: string
  onCopy?: () => void
}) => {
  const [copied, setCopied] = useState(false)

  const copyToClipboard = () => {
    if (typeof content === "string") {
      navigator.clipboard.writeText(content).then(() => {
        setCopied(true)
        if (onCopy) onCopy()
        setTimeout(() => setCopied(false), 2000)
      })
    }
  }

  return (
    <div className="space-y-2 relative">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-medium text-white tracking-wide">
          {title}
        </h2>
        {!isLoading && typeof content === "string" && (
          <button
            onClick={copyToClipboard}
            className={`text-xs px-2.5 py-1 rounded transition flex items-center gap-1.5 font-medium ${
              copied
                ? "bg-emerald-600 text-white"
                : "text-white bg-white/10 hover:bg-white/20"
            }`}
          >
            <span>{copied ? "✓" : "📋"}</span>
            <span>{copied ? "Copied!" : "Copy Code"}</span>
          </button>
        )}
      </div>
      {isLoading ? (
        <div className="space-y-1.5">
          <div className="mt-4 flex">
            <p className="text-xs bg-gradient-to-r from-gray-300 via-gray-100 to-gray-300 bg-clip-text text-transparent animate-pulse">
              Generating solution...
            </p>
          </div>
        </div>
      ) : (
        <div className="w-full relative rounded-md overflow-hidden border border-white/10">
          <SyntaxHighlighter
            showLineNumbers
            language={currentLanguage == "golang" ? "go" : currentLanguage}
            style={dracula}
            customStyle={{
              maxWidth: "100%",
              margin: 0,
              padding: "1rem",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              backgroundColor: "rgba(22, 27, 34, 0.75)"
            }}
            wrapLongLines={true}
          >
            {content as string}
          </SyntaxHighlighter>
        </div>
      )}
    </div>
  )
}

export const ComplexitySection = ({
  timeComplexity,
  spaceComplexity,
  isLoading
}: {
  timeComplexity: string | null
  spaceComplexity: string | null
  isLoading: boolean
}) => {
  const formatComplexity = (complexity: string | null): string => {
    if (!complexity || complexity.trim() === "") {
      return "Complexity not available";
    }
    const bigORegex = /O\([^)]+\)/i;
    if (bigORegex.test(complexity)) {
      return complexity;
    }
    return `O(${complexity})`;
  };
  
  const formattedTimeComplexity = formatComplexity(timeComplexity);
  const formattedSpaceComplexity = formatComplexity(spaceComplexity);
  
  return (
    <div className="space-y-2">
      <h2 className="text-[13px] font-medium text-white tracking-wide">
        Complexity Breakdown
      </h2>
      {isLoading ? (
        <p className="text-xs bg-gradient-to-r from-gray-300 via-gray-100 to-gray-300 bg-clip-text text-transparent animate-pulse">
          Calculating complexity...
        </p>
      ) : (
        <div className="space-y-3">
          <div className="text-[13px] leading-[1.4] text-gray-100 bg-white/5 rounded-md p-3">
            <div className="flex items-start gap-2">
              <div className="w-1 h-1 rounded-full bg-emerald-400 mt-2 shrink-0" />
              <div>
                <strong className="text-emerald-400">Time:</strong> {formattedTimeComplexity}
              </div>
            </div>
          </div>
          <div className="text-[13px] leading-[1.4] text-gray-100 bg-white/5 rounded-md p-3">
            <div className="flex items-start gap-2">
              <div className="w-1 h-1 rounded-full bg-purple-400 mt-2 shrink-0" />
              <div>
                <strong className="text-purple-400">Space:</strong> {formattedSpaceComplexity}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export const MCQSection = ({
  answer,
  eliminations,
  onCopy
}: {
  answer: string
  eliminations?: string[]
  onCopy?: () => void
}) => {
  const [copied, setCopied] = useState(false)
  const copyAnswer = () => {
    navigator.clipboard.writeText(answer).then(() => {
      setCopied(true)
      if (onCopy) onCopy()
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-medium text-emerald-400 tracking-wide flex items-center gap-1.5">
          <span>🎯</span> Correct Answer
        </h2>
        <button
          onClick={copyAnswer}
          className={`text-xs px-2.5 py-1 rounded transition flex items-center gap-1.5 font-medium ${
            copied ? "bg-emerald-600 text-white" : "text-white bg-white/10 hover:bg-white/20"
          }`}
        >
          <span>{copied ? "✓" : "📋"}</span>
          <span>{copied ? "Copied!" : "Copy Answer"}</span>
        </button>
      </div>

      <div className="p-3 bg-emerald-500/15 border border-emerald-500/40 rounded-lg text-emerald-200 text-sm font-semibold leading-snug">
        {answer}
      </div>

      {eliminations && eliminations.length > 0 && (
        <div className="space-y-1.5 mt-2">
          <h3 className="text-xs font-medium text-zinc-400">Elimination Analysis:</h3>
          {eliminations.map((el, i) => (
            <div key={i} className="text-xs text-zinc-300 bg-white/5 p-2 rounded border border-white/5 flex items-start gap-2">
              <span className="text-red-400 text-xs shrink-0 mt-0.5">✕</span>
              <span>{el}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export const STARSection = ({
  star,
  onCopy
}: {
  star: { situation: string; task: string; action: string; result: string }
  onCopy?: () => void
}) => {
  const [copied, setCopied] = useState(false)
  const copyStar = () => {
    const fullText = `SITUATION:\n${star.situation}\n\nTASK:\n${star.task}\n\nACTION:\n${star.action}\n\nRESULT:\n${star.result}`
    navigator.clipboard.writeText(fullText).then(() => {
      setCopied(true)
      if (onCopy) onCopy()
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-medium text-purple-300 tracking-wide flex items-center gap-1.5">
          <span>🌟</span> STAR Behavioral Framework
        </h2>
        <button
          onClick={copyStar}
          className={`text-xs px-2.5 py-1 rounded transition flex items-center gap-1.5 font-medium ${
            copied ? "bg-purple-600 text-white" : "text-white bg-white/10 hover:bg-white/20"
          }`}
        >
          <span>{copied ? "✓" : "📋"}</span>
          <span>{copied ? "Copied!" : "Copy STAR Story"}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2.5">
        <div className="p-3 bg-blue-950/40 border border-blue-500/30 rounded-lg">
          <div className="text-xs font-bold text-blue-400 mb-1 flex items-center gap-1">
            <span className="px-1.5 py-0.5 bg-blue-500/20 rounded">S</span> SITUATION (Context)
          </div>
          <div className="text-xs text-zinc-200 leading-relaxed">{star.situation}</div>
        </div>

        <div className="p-3 bg-purple-950/40 border border-purple-500/30 rounded-lg">
          <div className="text-xs font-bold text-purple-400 mb-1 flex items-center gap-1">
            <span className="px-1.5 py-0.5 bg-purple-500/20 rounded">T</span> TASK (Goal & Challenge)
          </div>
          <div className="text-xs text-zinc-200 leading-relaxed">{star.task}</div>
        </div>

        <div className="p-3 bg-emerald-950/40 border border-emerald-500/30 rounded-lg">
          <div className="text-xs font-bold text-emerald-400 mb-1 flex items-center gap-1">
            <span className="px-1.5 py-0.5 bg-emerald-500/20 rounded">A</span> ACTION (Your Leadership & Execution)
          </div>
          <div className="text-xs text-zinc-200 leading-relaxed">{star.action}</div>
        </div>

        <div className="p-3 bg-amber-950/40 border border-amber-500/30 rounded-lg">
          <div className="text-xs font-bold text-amber-400 mb-1 flex items-center gap-1">
            <span className="px-1.5 py-0.5 bg-amber-500/20 rounded">R</span> RESULT (Metrics & Learnings)
          </div>
          <div className="text-xs text-zinc-200 leading-relaxed">{star.result}</div>
        </div>
      </div>
    </div>
  )
}

export const SystemDesignSection = ({
  design,
  onCopy
}: {
  design: { architecture_overview?: string; core_components?: string[]; data_model?: string; scalability_tradeoffs?: string[] }
  onCopy?: () => void
}) => {
  const [copied, setCopied] = useState(false)
  const copyDesign = () => {
    const fullText = `ARCHITECTURE:\n${design.architecture_overview || ''}\n\nCOMPONENTS:\n${(design.core_components || []).join('\n')}\n\nDATA MODEL:\n${design.data_model || ''}\n\nSCALABILITY:\n${(design.scalability_tradeoffs || []).join('\n')}`
    navigator.clipboard.writeText(fullText).then(() => {
      setCopied(true)
      if (onCopy) onCopy()
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-medium text-cyan-300 tracking-wide flex items-center gap-1.5">
          <span>📐</span> System Architecture & Design
        </h2>
        <button
          onClick={copyDesign}
          className={`text-xs px-2.5 py-1 rounded transition flex items-center gap-1.5 font-medium ${
            copied ? "bg-cyan-600 text-white" : "text-white bg-white/10 hover:bg-white/20"
          }`}
        >
          <span>{copied ? "✓" : "📋"}</span>
          <span>{copied ? "Copied!" : "Copy Architecture"}</span>
        </button>
      </div>

      {design.architecture_overview && (
        <div className="p-3 bg-cyan-950/40 border border-cyan-500/30 rounded-lg">
          <div className="text-xs font-bold text-cyan-400 mb-1">Architecture Pattern</div>
          <div className="text-xs text-zinc-200 leading-relaxed">{design.architecture_overview}</div>
        </div>
      )}

      {design.core_components && design.core_components.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-bold text-zinc-400">Core Components:</div>
          <div className="grid grid-cols-1 gap-1.5">
            {design.core_components.map((comp, idx) => (
              <div key={idx} className="p-2 bg-white/5 border border-white/10 rounded text-xs text-zinc-200 flex items-start gap-2">
                <span className="text-cyan-400">●</span>
                <span>{comp}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {design.data_model && (
        <div className="p-3 bg-indigo-950/40 border border-indigo-500/30 rounded-lg">
          <div className="text-xs font-bold text-indigo-400 mb-1">Data Model & DB Access</div>
          <div className="text-xs text-zinc-200 leading-relaxed">{design.data_model}</div>
        </div>
      )}

      {design.scalability_tradeoffs && design.scalability_tradeoffs.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-bold text-zinc-400">Scalability & Trade-offs:</div>
          <div className="space-y-1">
            {design.scalability_tradeoffs.map((item, idx) => (
              <div key={idx} className="p-2 bg-white/5 border border-white/10 rounded text-xs text-zinc-200 flex items-start gap-2">
                <span className="text-amber-400">⚖️</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export interface SolutionsProps {
  setView: (view: "queue" | "solutions" | "debug") => void
  credits: number
  currentLanguage: string
  setLanguage: (language: string) => void
}
const Solutions: React.FC<SolutionsProps> = ({
  setView,
  credits,
  currentLanguage,
  setLanguage
}) => {
  const queryClient = useQueryClient()
  const contentRef = useRef<HTMLDivElement>(null)
  const { showToast } = useToast()

  const [debugProcessing, setDebugProcessing] = useState(false)
  const [problemStatementData, setProblemStatementData] =
    useState<ProblemStatementData | null>(null)
  const [solutionData, setSolutionData] = useState<string | null>(null)
  const [thoughtsData, setThoughtsData] = useState<string[] | null>(null)
  const [timeComplexityData, setTimeComplexityData] = useState<string | null>(
    null
  )
  const [spaceComplexityData, setSpaceComplexityData] = useState<string | null>(
    null
  )

  const [answerText, setAnswerText] = useState<string>("")
  const [questionType, setQuestionType] = useState<string>("coding")
  const [mcqAnswer, setMcqAnswer] = useState<string | null>(null)
  const [mcqEliminations, setMcqEliminations] = useState<string[]>([])
  const [starBreakdown, setStarBreakdown] = useState<{
    situation: string
    task: string
    action: string
    result: string
  } | null>(null)
  const [systemDesign, setSystemDesign] = useState<{
    architecture_overview?: string
    core_components?: string[]
    data_model?: string
    scalability_tradeoffs?: string[]
  } | null>(null)

  const [isTooltipVisible, setIsTooltipVisible] = useState(false)
  const [tooltipHeight, setTooltipHeight] = useState(0)

  const [isResetting, setIsResetting] = useState(false)

  interface Screenshot {
    id: string
    path: string
    preview: string
    timestamp: number
  }

  const [extraScreenshots, setExtraScreenshots] = useState<Screenshot[]>([])

  useEffect(() => {
    const fetchScreenshots = async () => {
      try {
        const existing = await window.electronAPI.getScreenshots()
        console.log("Raw screenshot data:", existing)
        const screenshots = (Array.isArray(existing) ? existing : []).map(
          (p) => ({
            id: p.path,
            path: p.path,
            preview: p.preview,
            timestamp: Date.now()
          })
        )
        console.log("Processed screenshots:", screenshots)
        setExtraScreenshots(screenshots)
      } catch (error) {
        console.error("Error loading extra screenshots:", error)
        setExtraScreenshots([])
      }
    }

    fetchScreenshots()
  }, [solutionData])

  const [isGeneratingAlt, setIsGeneratingAlt] = useState(false)

  const handleGenerateAlternative = async () => {
    setIsGeneratingAlt(true)
    try {
      if (window.electronAPI.triggerAlternativeSolution) {
        await window.electronAPI.triggerAlternativeSolution()
      }
    } catch (e) {
      console.error("Failed to trigger alternative solution:", e)
      showToast("Error", "Could not generate alternative solution", "error")
    } finally {
      setIsGeneratingAlt(false)
    }
  }

  useEffect(() => {
    // Set up event listeners
    const cleanupFunctions = [
      window.electronAPI.onScreenshotTaken(async () => {
        try {
          const existing = await window.electronAPI.getScreenshots()
          const screenshots = (Array.isArray(existing) ? existing : []).map(
            (p) => ({
              id: p.path,
              path: p.path,
              preview: p.preview,
              timestamp: Date.now()
            })
          )
          setExtraScreenshots(screenshots)
        } catch (error) {
          console.error("Error loading extra screenshots:", error)
        }
      }),
      window.electronAPI.onResetView(() => {
        // Set resetting state first
        setIsResetting(true)

        // Remove queries
        queryClient.removeQueries({
          queryKey: ["solution"]
        })
        queryClient.removeQueries({
          queryKey: ["new_solution"]
        })

        // Reset screenshots
        setExtraScreenshots([])

        // After a small delay, clear the resetting state
        setTimeout(() => {
          setIsResetting(false)
        }, 0)
      }),
      window.electronAPI.onSolutionStart(() => {
        // Clear the previous debug view when answering a new question.
        queryClient.removeQueries({ queryKey: ["new_solution"] })
        setSolutionData(null)
        setThoughtsData(null)
        setTimeComplexityData(null)
        setSpaceComplexityData(null)
        setAnswerText("")
        setMcqAnswer(null)
        setMcqEliminations([])
        setStarBreakdown(null)
        setSystemDesign(null)
      }),
      window.electronAPI.onProblemExtracted((data) => {
        queryClient.setQueryData(["problem_statement"], data)
      }),
      //if there was an error processing the initial solution
      window.electronAPI.onSolutionError((error: string) => {
        showToast("Processing Failed", error, "error")
        // Reset solutions in the cache (even though this shouldn't ever happen) and complexities to previous states
        const solution = queryClient.getQueryData(["solution"]) as {
          code: string
          thoughts: string[]
          time_complexity: string
          space_complexity: string
        } | null
        if (!solution) {
          setView("queue")
        }
        const cached = queryClient.getQueryData<QuestionAnswer>(["solution"])
        setAnswerText(cached?.answer || "")
        setQuestionType(cached?.type || (cached?.code ? "coding" : "general"))
        setMcqAnswer(cached?.mcq_answer || null)
        setMcqEliminations(cached?.mcq_eliminations || [])
        setStarBreakdown(cached?.star_breakdown || null)
        setSystemDesign(cached?.system_design || null)
        setSolutionData(cached ? cached.code || "general" : null)
        setThoughtsData(solution?.thoughts || null)
        setTimeComplexityData(solution?.time_complexity || null)
        setSpaceComplexityData(solution?.space_complexity || null)
        console.error("Processing error:", error)
      }),
      //when the initial solution is generated, we'll set the solution data to that
      window.electronAPI.onSolutionSuccess((data) => {
        if (!data) {
          console.warn("Received empty or invalid solution data")
          return
        }
        console.log({ data })
        const solutionData = {
          type: data.type || (data.code ? "coding" : "general"),
          answer: data.answer || "",
          code: data.code,
          thoughts: data.thoughts,
          time_complexity: data.time_complexity,
          space_complexity: data.space_complexity,
          mcq_answer: data.mcq_answer,
          mcq_eliminations: data.mcq_eliminations,
          star_breakdown: data.star_breakdown,
          system_design: data.system_design
        }

        queryClient.setQueryData(["solution"], solutionData)
        setAnswerText(solutionData.answer)
        setQuestionType(solutionData.type)
        setSolutionData(solutionData.code || (solutionData.mcq_answer ? "mcq" : solutionData.star_breakdown ? "star" : solutionData.system_design ? "system_design" : "general"))
        setThoughtsData(solutionData.thoughts || null)
        setTimeComplexityData(solutionData.time_complexity || null)
        setSpaceComplexityData(solutionData.space_complexity || null)
        setMcqAnswer(solutionData.mcq_answer || null)
        setMcqEliminations(solutionData.mcq_eliminations || [])
        setStarBreakdown(solutionData.star_breakdown || null)
        setSystemDesign(solutionData.system_design || null)

        if (solutionData.type === "mcq") {
          showToast("🎯 MCQ Answer Ready", "Option copied to clipboard", "success")
        } else if (solutionData.type === "behavioral") {
          showToast("🌟 STAR Story Ready", "Talking points copied to clipboard", "success")
        } else if (solutionData.type === "system_design") {
          showToast("📐 Architecture Ready", "Design breakdown ready", "success")
        } else {
          showToast("⚡ Solution Ready", "Copied to clipboard (Ctrl+V ready)", "success")
        }

        // Fetch latest screenshots when solution is successful
        const fetchScreenshots = async () => {
          try {
            const existing = await window.electronAPI.getScreenshots()
            const screenshots =
              (Array.isArray(existing) ? existing : []).map((p: any) => ({
                id: p.path,
                path: p.path,
                preview: p.preview,
                timestamp: Date.now()
              })) || []
            setExtraScreenshots(screenshots)
          } catch (error) {
            console.error("Error loading extra screenshots:", error)
            setExtraScreenshots([])
          }
        }
        fetchScreenshots()
      }),

      //########################################################
      //DEBUG EVENTS
      //########################################################
      window.electronAPI.onDebugStart(() => {
        //we'll set the debug processing state to true and use that to render a little loader
        setDebugProcessing(true)
      }),
      //the first time debugging works, we'll set the view to debug and populate the cache with the data
      window.electronAPI.onDebugSuccess((data) => {
        queryClient.setQueryData(["new_solution"], data)
        setDebugProcessing(false)
      }),
      //when there was an error in the initial debugging, we'll show a toast and stop the little generating pulsing thing.
      window.electronAPI.onDebugError(() => {
        showToast(
          "Processing Failed",
          "There was an error debugging your code.",
          "error"
        )
        setDebugProcessing(false)
      }),
      window.electronAPI.onProcessingNoScreenshots(() => {
        showToast(
          "No Screenshots",
          "There are no extra screenshots to process.",
          "neutral"
        )
      }),
      // Removed out of credits handler - unlimited credits in this version
    ]

    return () => {
      cleanupFunctions.forEach((cleanup) => cleanup())
    }
  }, [isTooltipVisible, tooltipHeight])

  useEffect(() => {
    setProblemStatementData(
      queryClient.getQueryData(["problem_statement"]) || null
    )
    const syncAnswer = () => {
      const answer = queryClient.getQueryData<QuestionAnswer>(["solution"])
      setQuestionType(answer?.type || (answer?.code ? "coding" : "general"))
      setAnswerText(answer?.answer || "")
      setSolutionData(answer ? answer.code || "general" : null)
      setThoughtsData(answer?.thoughts || [])
      setTimeComplexityData(answer?.time_complexity || null)
      setSpaceComplexityData(answer?.space_complexity || null)
      setMcqAnswer(answer?.mcq_answer || null)
      setMcqEliminations(answer?.mcq_eliminations || [])
      setStarBreakdown(answer?.star_breakdown || null)
      setSystemDesign(answer?.system_design || null)
    }
    syncAnswer()
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event?.query.queryKey[0] === "problem_statement") {
        setProblemStatementData(queryClient.getQueryData(["problem_statement"]) || null)
      }
      if (event?.query.queryKey[0] === "solution") syncAnswer()
    })
    return () => unsubscribe()
  }, [queryClient])

  const handleTooltipVisibilityChange = (visible: boolean, height: number) => {
    setIsTooltipVisible(visible)
    setTooltipHeight(height)
  }

  const handleDeleteExtraScreenshot = async (index: number) => {
    const screenshotToDelete = extraScreenshots[index]

    try {
      const response = await window.electronAPI.deleteScreenshot(
        screenshotToDelete.path
      )

      if (response.success) {
        // Fetch and update screenshots after successful deletion
        const existing = await window.electronAPI.getScreenshots()
        const screenshots = (Array.isArray(existing) ? existing : []).map(
          (p) => ({
            id: p.path,
            path: p.path,
            preview: p.preview,
            timestamp: Date.now()
          })
        )
        setExtraScreenshots(screenshots)
      } else {
        console.error("Failed to delete extra screenshot:", response.error)
        showToast("Error", "Failed to delete the screenshot", "error")
      }
    } catch (error) {
      console.error("Error deleting extra screenshot:", error)
      showToast("Error", "Failed to delete the screenshot", "error")
    }
  }

  return (
    <>
      {!isResetting && queryClient.getQueryData(["new_solution"]) ? (
        <Debug
          isProcessing={debugProcessing}
          setIsProcessing={setDebugProcessing}
          currentLanguage={currentLanguage}
          setLanguage={setLanguage}
        />
      ) : (
        <div ref={contentRef} className="relative">
          <div className="space-y-3 px-4 py-3">
          {/* Conditionally render the screenshot queue if solutionData is available */}
          {solutionData && (
            <div className="bg-transparent w-fit">
              <div className="pb-3">
                <div className="space-y-3 w-fit">
                  <ScreenshotQueue
                    isLoading={debugProcessing}
                    screenshots={extraScreenshots}
                    onDeleteScreenshot={handleDeleteExtraScreenshot}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Navbar of commands with the SolutionsHelper */}
          <SolutionCommands
            onTooltipVisibilityChange={handleTooltipVisibilityChange}
            isProcessing={!problemStatementData || !solutionData}
            extraScreenshots={extraScreenshots}
            credits={credits}
            currentLanguage={currentLanguage}
            setLanguage={setLanguage}
          />

          {/* Main Content - Modified width constraints */}
          <div className="w-full text-sm text-black bg-black/60 rounded-md">
            <div className="rounded-lg overflow-hidden">
              <div className="px-4 py-3 space-y-4 max-w-full">
                {!solutionData && (
                  <>
                    <ContentSection
                      title="Problem Statement"
                      content={problemStatementData?.problem_statement}
                      isLoading={!problemStatementData}
                    />
                    {problemStatementData && (
                      <div className="mt-4 flex">
                        <p className="text-xs bg-gradient-to-r from-gray-300 via-gray-100 to-gray-300 bg-clip-text text-transparent animate-pulse">
                          Generating solutions...
                        </p>
                      </div>
                    )}
                  </>
                )}

                {solutionData && (
                  <>
                    <ContentSection title="Question" content={problemStatementData?.problem_statement} isLoading={false} />
                    {answerText && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h2 className="text-[13px] font-medium text-white">Answer</h2>
                          <button className="text-xs text-white bg-white/10 rounded px-2 py-1" onClick={() => navigator.clipboard.writeText(answerText).then(() => showToast("Copied", "Answer copied to clipboard", "success"))}>Copy Answer</button>
                        </div>
                        <div className="text-[13px] text-gray-100 leading-relaxed whitespace-pre-wrap break-words">{answerText}</div>
                      </div>
                    )}
                    {/* MCQ Mode */}
                    {mcqAnswer && (
                      <MCQSection
                        answer={mcqAnswer}
                        eliminations={mcqEliminations}
                      />
                    )}

                    {/* Behavioral STAR Mode */}
                    {starBreakdown && (
                      <STARSection star={starBreakdown} />
                    )}

                    {/* System Design Mode */}
                    {systemDesign && (
                      <SystemDesignSection design={systemDesign} />
                    )}

                    {/* Coding Mode Badges */}
                    {questionType === "coding" && solutionData !== "general" && (
                      <ComplexityBadges
                        timeComplexity={timeComplexityData}
                        spaceComplexity={spaceComplexityData}
                        onAlternativeClick={handleGenerateAlternative}
                        isGeneratingAlt={isGeneratingAlt}
                      />
                    )}

                    {/* Universal Thoughts / Speaking Points */}
                    <ContentSection
                      title="Key Takeaways"
                      content={
                        thoughtsData && (
                          <div className="space-y-3">
                            <div className="space-y-1">
                              {thoughtsData.map((thought, index) => (
                                <div
                                  key={index}
                                  className="flex items-start gap-2"
                                >
                                  <div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5 shrink-0" />
                                  <div className="text-zinc-200">{thought}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )
                      }
                      isLoading={false}
                    />

                    {/* Coding Solution Code (if code present) */}
                    {questionType === "coding" && solutionData !== "general" && (
                      <>
                        <SolutionSection
                          title="Implementation"
                          content={solutionData}
                          isLoading={!solutionData}
                          currentLanguage={currentLanguage}
                        />

                        <ComplexitySection
                          timeComplexity={timeComplexityData}
                          spaceComplexity={spaceComplexityData}
                          isLoading={!timeComplexityData || !spaceComplexityData}
                        />
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      )}
    </>
  )
}

export default Solutions
