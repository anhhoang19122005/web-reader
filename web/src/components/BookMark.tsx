export function BookMark({ title }: { title: string }) {
  return <span className="book-cover" aria-hidden="true">{title.trim().charAt(0) || "S"}</span>;
}
