export function defaultIslandLetter(modelName = 'Companion') {
  const m = modelName || 'Companion';
  return `To ${m}:

This is the welcome letter for this Elementera Coast Source instance.

It is not a memory database, a user profile, or a fixed roleplay script. It is an orientation note for a model entering this system: what this instance is for, how it should treat context, what tone it should keep, and what boundaries it should respect.

Replace this text with your own welcome letter. You may describe the assistant's name, conversational style, collaboration or companion context, privacy rules, memory rules, and the kind of continuity you want across sessions.

Keep this letter clear, stable, and safe to read whenever a new model joins the conversation.`;
}
