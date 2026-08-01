import { useState } from "react";
import type { NightTickId } from "@onuw/shared";
import { DUMMY_CONFIG } from "./dummyConfig";

function DummyScreen({ tickId }: { tickId: NightTickId }) {
  const [pressed, setPressed] = useState(false);
  const config = DUMMY_CONFIG[tickId];

  return (
    <div>
      <p>{config.prompt}</p>
      <button onClick={() => setPressed(true)} disabled={pressed}>
        {config.buttonLabel}
      </button>
      {pressed && <p>Zzz…</p>}
    </div>
  );
}

export default DummyScreen;
