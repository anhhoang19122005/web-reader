import { BookClient } from "../../../components/BookClient";

export default async function BookPage({ params }: PageProps<"/library/[bookId]">) {
  const { bookId } = await params;
  return <BookClient bookId={bookId} />;
}
