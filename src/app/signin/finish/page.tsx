import { Suspense } from "react";
import FinishSignIn from "./FinishSignIn";

export default function FinishPage() {
  return (
    <Suspense>
      <FinishSignIn />
    </Suspense>
  );
}
