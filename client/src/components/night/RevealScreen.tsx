import { useState, type ReactNode } from "react";

function RevealScreen({ children, onContinue }: { children: ReactNode; onContinue: () => void }) {
  const [pressed, setPressed] = useState(false);

  return (
    <div>
      {children}
      <button
        onClick={() => {
          setPressed(true);
          onContinue();
        }}
        disabled={pressed}
      >
        J'ai vu
      </button>
    </div>
  );
}

export default RevealScreen;
