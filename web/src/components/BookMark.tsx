export function BookMark({ title }: { title: string }) {
  return <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-amber-900 font-serif text-lg font-bold text-amber-50">{title.trim().charAt(0) || "S"}</span>;
}
