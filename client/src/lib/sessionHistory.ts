let queries: string[] = [];
export const getHistory = () => queries;
export function rememberQuery(query: string) {
  queries = [query, ...queries.filter((item) => item !== query)].slice(0, 25);
}
export function clearHistory() {
  queries = [];
}
