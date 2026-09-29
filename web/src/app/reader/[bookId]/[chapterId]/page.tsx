import { ReaderClient } from "../../../../components/ReaderClient";

export default async function ReaderPage({ params }: PageProps<"/reader/[bookId]/[chapterId]">) {
  const { bookId, chapterId } = await params;
  return <ReaderClient bookId={bookId} chapterId={chapterId} />;
}
