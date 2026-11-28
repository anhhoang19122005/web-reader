import { ReaderFocusReset } from "../../../components/ReaderFocusReset";

export default function ReaderBookLayout({ children }: LayoutProps<"/reader/[bookId]">) {
  return <>{children}<ReaderFocusReset /></>;
}
