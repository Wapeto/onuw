import { useEffect, useState } from "react";
import QRCode from "qrcode";

interface RoomQrCodeProps {
  roomCode: string;
}

function RoomQrCode({ roomCode }: RoomQrCodeProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!roomCode) {
      setDataUrl(null);
      return;
    }
    let cancelled = false;
    const joinUrl = `${window.location.origin}/join/${roomCode}`;
    QRCode.toDataURL(joinUrl).then((url) => {
      if (!cancelled) setDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [roomCode]);

  if (!dataUrl) return null;
  return <img src={dataUrl} alt={`QR code pour rejoindre la room ${roomCode}`} />;
}

export default RoomQrCode;
