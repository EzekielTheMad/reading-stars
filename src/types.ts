import type { BookInput, Quiz, Effort } from "../shared/schema";
import type { RewardBook } from "../shared/rewards";
export interface Child {
  id: string;
  name: string;
  age: number;
  color: "green" | "orange" | "blue" | "purple";
  profile: string;
  confidence: string;
  readingBand?: number | null;
}
export interface Upload {
  id: string;
  kind: string;
  name: string;
  mime: string;
  warnings: string[];
}
export interface Book extends BookInput {
  reward: RewardBook;
  id: string;
  coverId?: string;
  readyForChildren: boolean;
  preparationNeeds: string[];
  requiredQuestions: number;
  approvedQuestionCount: number;
  draft: Quiz | null;
  sources: { url: string; title: string }[];
  uploads: Upload[];
  quizzes: { id: string; created: string }[];
}
export interface Assignment {
  id: string;
  child_id: string;
  book_id: string;
  stars: number;
  question_count: number;
  effort: Effort;
  rationale: string;
  status: string;
  canComplete?: boolean;
  award?: { stars: number; recorded: string | null } | null;
}
export interface Attempt {
  id: string;
  assignmentId: string;
  score: number | null;
  submitted: string | null;
  answers: Record<string, string>;
  questions: {
    id: string;
    prompt: string;
    options: { id: string; text: string }[];
  }[];
}
export interface ReviewAttempt {
  created: string;
  id: string;
  assignment_id: string;
  score: number | null;
  submitted: string | null;
  answers: Record<string, string>;
  questions: { id: string; order: number[] }[];
  quiz: Quiz;
}
export interface Award {
  id: string;
  child_id: string;
  book_id: string;
  assignment_id: string;
  stars: number;
  recorded: string | null;
  reason: string;
  created: string;
}
export interface Shelf {
  children: Child[];
  books: LibraryBook[];
  assignments: Assignment[];
  daily: Record<string,{day:string;used:number;remaining:number;limit:number;timeZone:string}>;
}
export type LibraryBook = Pick<Book, "id" | "title" | "author" | "format" | "coverId"> & {offers:Record<string,{stars:number|null;needsParent:boolean;questionCount:number;quizReady:boolean}>};
export interface ParentData {
  timeZone: string;
  children: Child[];
  books: Book[];
  assignments: Assignment[];
  awards: Award[];
  attempts: ReviewAttempt[];
  aiAvailable: boolean;
  aiUsage: { operation: string; status: string; created: string }[];
  audit: { action: string; detail: string; created: string }[];
}
export interface Session {
  setup: boolean;
  authenticated: boolean;
  parent: boolean;
  aiAvailable: boolean;
}
