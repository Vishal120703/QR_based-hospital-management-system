import { type ZodError, type ZodIssue } from 'zod';

// "displayName" → "Display name"; an array position names the item:
// levels.1.delayMinutes → "Delay minutes (item 2)".
function fieldLabel(path: readonly (string | number)[]): string | null {
  const name = path.filter((part): part is string => typeof part === 'string').at(-1);
  if (!name) return null;
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  const label = words.charAt(0).toUpperCase() + words.slice(1);
  const index = path.filter((part): part is number => typeof part === 'number').at(-1);
  return index === undefined ? label : `${label} (item ${index + 1})`;
}

// One plain sentence about a field that failed validation, for the person who
// filled in the form. Messages written in a schema's refine() are used as is.
function describeIssue(issue: ZodIssue): string {
  const field = fieldLabel(issue.path);
  const subject = field ?? 'The request';
  switch (issue.code) {
    case 'custom':
      return issue.message;
    case 'invalid_type':
      if (!field) return 'Send the details as a JSON object.';
      return issue.received === 'undefined' ? `${field} is required.` : `${field} is not valid.`;
    case 'too_small':
      if (issue.type === 'string') {
        return Number(issue.minimum) <= 1
          ? `${subject} is required.`
          : `${subject} must be at least ${issue.minimum} characters.`;
      }
      if (issue.type === 'array') return `${subject} needs at least ${issue.minimum}.`;
      return `${subject} must be at least ${issue.minimum}.`;
    case 'too_big':
      if (issue.type === 'string') return `${subject} must be at most ${issue.maximum} characters.`;
      if (issue.type === 'array') return `${subject} can have at most ${issue.maximum}.`;
      return `${subject} must be at most ${issue.maximum}.`;
    case 'invalid_string':
      if (issue.validation === 'email') return `${subject} must be a valid email address.`;
      if (issue.validation === 'uuid') return `${subject} is not a valid id.`;
      if (issue.validation === 'regex') return `${subject} has characters that are not allowed.`;
      return `${subject} is not valid.`;
    case 'invalid_enum_value':
      return `${subject} must be one of: ${issue.options.join(', ')}.`;
    case 'invalid_union_discriminator':
      return `${subject} must be one of: ${issue.options.map(String).join(', ')}.`;
    case 'invalid_date':
      return `${subject} must be a valid date.`;
    case 'unrecognized_keys':
      return `Unknown field${issue.keys.length === 1 ? '' : 's'}: ${issue.keys.join(', ')}.`;
    default:
      return `${subject} is not valid.`;
  }
}

// The first problem as the message, plus every field that needs attention.
export function describeValidationError(error: ZodError): { message: string; fields: string[] } {
  const [first] = error.issues;
  return {
    message: first ? describeIssue(first) : 'Invalid request input.',
    fields: [...new Set(error.issues.map((issue) => issue.path.join('.')).filter(Boolean))],
  };
}
