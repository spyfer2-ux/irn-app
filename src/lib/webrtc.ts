/**
 * Transmissão própria pelo Cloudflare Stream usando WebRTC:
 * - WHIP: quem transmite (câmera do celular) envia para o Stream;
 * - WHEP: quem assiste recebe do Stream.
 */

const ICE: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }];

function waitIce(pc: RTCPeerConnection, ms: number): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    }
    function check() {
      if (pc.iceGatheringState === 'complete') done();
    }
    pc.addEventListener('icegatheringstatechange', check);
  });
}

export class StreamError extends Error {
  status: number;
  constructor(msg: string, status: number) {
    super(msg);
    this.status = status;
  }
}

async function negotiate(pc: RTCPeerConnection, url: string): Promise<string> {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitIce(pc, 2500);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/sdp' },
    body: pc.localDescription!.sdp,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new StreamError(text || `Erro ${res.status}`, res.status);
  }
  const answer = await res.text();
  await pc.setRemoteDescription({ type: 'answer', sdp: answer });
  const loc = res.headers.get('location');
  return loc ? new URL(loc, url).toString() : '';
}

export class Broadcaster {
  private pc: RTCPeerConnection | null = null;
  private resource = '';
  onState: (s: RTCPeerConnectionState) => void = () => undefined;

  async start(stream: MediaStream, whipUrl: string) {
    const pc = new RTCPeerConnection({ iceServers: ICE, bundlePolicy: 'max-bundle' });
    this.pc = pc;
    pc.onconnectionstatechange = () => this.onState(pc.connectionState);
    for (const track of stream.getTracks()) {
      const tr = pc.addTransceiver(track, { direction: 'sendonly', streams: [stream] });
      if (track.kind === 'video') {
        const params = tr.sender.getParameters();
        params.encodings = [{ ...(params.encodings?.[0] ?? {}), maxBitrate: 2_500_000 }];
        await tr.sender.setParameters(params).catch(() => undefined);
      }
    }
    this.resource = await negotiate(pc, whipUrl);
  }

  replaceTrack(track: MediaStreamTrack) {
    const sender = this.pc?.getSenders().find((s) => s.track?.kind === track.kind);
    return sender?.replaceTrack(track);
  }

  async stats(): Promise<{ kbps: number } | null> {
    if (!this.pc) return null;
    const report = await this.pc.getStats();
    let bytes = 0;
    report.forEach((r) => {
      if (r.type === 'outbound-rtp') bytes += (r as RTCOutboundRtpStreamStats).bytesSent ?? 0;
    });
    const now = performance.now();
    const prev = this.last;
    this.last = { bytes, at: now };
    if (!prev) return null;
    return { kbps: Math.round(((bytes - prev.bytes) * 8) / (now - prev.at)) };
  }
  private last: { bytes: number; at: number } | null = null;

  async stop() {
    const res = this.resource;
    this.resource = '';
    this.pc?.close();
    this.pc = null;
    if (res) await fetch(res, { method: 'DELETE' }).catch(() => undefined);
  }
}

export class Player {
  private pc: RTCPeerConnection | null = null;
  private resource = '';
  onState: (s: RTCPeerConnectionState) => void = () => undefined;

  async start(whepUrl: string, video: HTMLVideoElement) {
    const pc = new RTCPeerConnection({ iceServers: ICE, bundlePolicy: 'max-bundle' });
    this.pc = pc;
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });
    const stream = new MediaStream();
    pc.ontrack = (e) => {
      stream.addTrack(e.track);
      video.srcObject = stream;
    };
    pc.onconnectionstatechange = () => this.onState(pc.connectionState);
    this.resource = await negotiate(pc, whepUrl);
  }

  async stop() {
    const res = this.resource;
    this.resource = '';
    this.pc?.close();
    this.pc = null;
    if (res) await fetch(res, { method: 'DELETE' }).catch(() => undefined);
  }
}
