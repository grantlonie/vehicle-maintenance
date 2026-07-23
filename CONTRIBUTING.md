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
- **Function order in modules**: Public entry points and callers first, private helpers below
- **Programming paradigm**: Prefer functions over classes
- **Object sorting**: Alphabetical property ordering where practical
- **Component props**: Sort alphabetically in both type definitions and JSX usage
- **Comments**: Avoid unnecessary comments; prefer self-explanatory code
- **Imports**: Alphabetical order

## TypeScript

- Avoid `any`
- Prefer `interface` when extending; `type` is fine for unions and props aliases
- Import domain types from `@vehicles/shared`

## React

1. Functional components with hooks
2. Name the props type `ComponentNameProps`
3. Server state: TanStack Query
4. Local state: `useState` / `useReducer`
