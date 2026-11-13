// Preserve typed whitespace; normalize only the submitted question.
export function composeQuestionText(text: string, interim: string): string {
  if (!interim) return text
  return `${text}${text && !/\s$/.test(text) ? ' ' : ''}${interim}`
}
