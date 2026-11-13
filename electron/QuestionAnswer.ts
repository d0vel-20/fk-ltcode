export interface QuestionAnswer {
  type: string
  title: string
  problem_statement: string
  answer: string
  code: string | null
  thoughts: string[]
  time_complexity: string | null
  space_complexity: string | null
  mcq_answer: string | null
  mcq_eliminations: string[]
  star_breakdown: { situation: string; task: string; action: string; result: string } | null
  system_design: { architecture_overview?: string; core_components?: string[]; data_model?: string; scalability_tradeoffs?: string[] } | null
}

export function questionPrompt(language: string, context = ""): string {
  return `Answer the supplied question accurately in its own field: mathematics, sciences, medicine, law, history, languages, education, engineering, business, finance, arts, everyday knowledge, or any other subject. Do not assume it is a coding question or an interview. Answer in the language used by the question unless requested otherwise.
Read all supplied images or transcribe the audio. Answer every question visible or asked, preserving numbering. For calculations show equations, steps, units, and the final result. For explanations give a complete direct answer with useful examples. For multiple choice identify the correct option and explain why. For writing or translation produce the requested text. State uncertainty or missing information instead of inventing facts, sources, or personal experiences. If something is unreadable, ask for the missing detail.
Use programming code only when the question explicitly requires it; preferred code language: ${language}. For coding answers, write the solution in ${language}, even if the screenshots or previous answer use another programming language, unless the latest user request explicitly asks for a different programming language. A short follow-up such as "fix" applies to the supplied screenshots or previous question and answer; it is not a standalone question when that context is present. Use STAR only for behavioral questions, and architecture fields only for system design. Non-coding questions must have null code and null time/space complexity.
Return ONLY a valid JSON object (no markdown fences) with this schema:
{
  "type": "coding | mathematics | science | medical | legal | humanities | business | writing | behavioral | system_design | mcq | general",
  "title": "Short question title",
  "problem_statement": "Question text, including all parts",
  "answer": "Complete answer with explanation, worked steps or requested written content. Use paragraphs and numbered steps where helpful. This is required for every question type.",
  "code": null,
  "thoughts": ["Optional key takeaways"],
  "time_complexity": null,
  "space_complexity": null,
  "mcq_answer": null,
  "mcq_eliminations": [],
  "star_breakdown": null,
  "system_design": null
}
For coding, fill code and applicable complexity. For MCQ fill mcq_answer and mcq_eliminations. If applicable, star_breakdown has situation/task/action/result; system_design has architecture_overview/core_components/data_model/scalability_tradeoffs.
${context}`
}

export function normalizeAnswer(raw: unknown): QuestionAnswer {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("AI returned an invalid answer")
  const data = raw as Record<string, any>
  const text = (value: unknown): string => typeof value === "string" ? value.trim() : ""
  const list = (value: unknown): string[] => Array.isArray(value) ? value.map(text).filter(Boolean) : text(value).split("\n").filter(Boolean)
  const code = text(data.code).replace(/^```[^\n]*\n|\n```$/g, "").trim() || null
  const type = text(data.type) || (code ? "coding" : "general")
  const thoughts = list(data.thoughts)
  const answer = text(data.answer) || text(data.mcq_answer) || thoughts.join("\n\n")
  if (!answer && !code) throw new Error("AI returned an empty answer. Please try again.")
  const star = data.star_breakdown
  const design = data.system_design
  return {
    type, title: text(data.title) || "Question", problem_statement: text(data.problem_statement), answer,
    code: type === "coding" ? code : null, thoughts,
    time_complexity: type === "coding" ? text(data.time_complexity) || null : null,
    space_complexity: type === "coding" ? text(data.space_complexity) || null : null,
    mcq_answer: text(data.mcq_answer) || null, mcq_eliminations: list(data.mcq_eliminations),
    star_breakdown: type === "behavioral" && star && typeof star === "object" ? {
      situation: text(star.situation), task: text(star.task), action: text(star.action), result: text(star.result)
    } : null,
    system_design: type === "system_design" && design && typeof design === "object" ? {
      architecture_overview: text(design.architecture_overview), core_components: list(design.core_components),
      data_model: text(design.data_model), scalability_tradeoffs: list(design.scalability_tradeoffs)
    } : null
  }
}
