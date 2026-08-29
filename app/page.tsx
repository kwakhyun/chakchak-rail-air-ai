import { permanentRedirect } from "next/navigation";

export default function HomePage() {
  permanentRedirect("/index.html");
}
