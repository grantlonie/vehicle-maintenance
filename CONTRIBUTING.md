# Contributing

Run `bun run format:check` before opening a PR. Prettier config matches project-starters/js.

## File & naming conventions

### File naming

- **Components**: PascalCase (e.g. `UserProfile.tsx`)
- **Utilities / libs**: camelCase (e.g. `formatDate.ts`)
- **Types**: PascalCase for type and interface names; shared types live in `@vehicles/shared`

### Code style

- **Formatting**: Prettier
- **Function declarations**: Prefer `function name() {}` over `const name = () => {}`
- **Named handlers**: Prefer named functions over inline arrow callbacks in JSX when the handler is non-trivial
- **Function order in modules**: Public entry points and callers first, private helpers below—rely on hoisting so helpers may appear after their first use
- **Programming paradigm**: Prefer functions over classes
- **Object sorting**: Alphabetical property ordering where practical
- **Component props**: Sort alphabetically in both type definitions and JSX usage
- **Comments**: Avoid unnecessary comments; prefer self-explanatory code
- **Imports**: Alphabetical order

## TypeScript

- **Strict typing**: Avoid `any`
- **Object shapes**: Prefer `interface` when extending; `type` is fine for unions and props aliases
- **Shared types**: Import domain types from `@vehicles/shared`

## React

### Component guidelines

1. Use functional components with hooks
2. Match patterns from existing components in the project
3. Name the props type `ComponentNameProps` (e.g. `DialogProps`)
4. Follow the project's chosen styling approach (Tailwind)
5. Prefer shared, reusable components with clear props types when a pattern does not already exist — see [UI_PATTERNS.md](./UI_PATTERNS.md)

### UI patterns

Interaction conventions (dialogs, editing surfaces, dirty state) live in [UI_PATTERNS.md](./UI_PATTERNS.md).

### State management

- **Server state**: TanStack Query
- **Global UI state**: React Context
- **Local state**: `useState` / `useReducer`
- **Related form / edit fields**: Prefer one state object over many parallel `useState`s — see [UI_PATTERNS.md](./UI_PATTERNS.md) (editing surfaces)

## Preferred libraries

Use these when the need arises; do not add them prophylactically. Prefer the project's existing choice if it already solves the same problem.

- **Deep equality / dirty checks**: Lodash `isEqual` (`lodash-es`) — see [UI_PATTERNS.md](./UI_PATTERNS.md) (editing surfaces)
- **Server/async data**: TanStack Query

## Code organization

- Keep related functionality together
- Check existing implementations before creating new abstractions
- Use `@vehicles/shared` for shared domain types and logic

## Performance

- Consider bundle size when adding dependencies
- Lazy-load heavy routes or components where appropriate
