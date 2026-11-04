// Captura o som do microfone em blocos de 1024 amostras por canal (o tamanho de um quadro AAC) e manda para a tela
// de transmissão do app, que codifica e envia para o YouTube. Sem entrada (microfone desligado), manda silêncio
// para o áudio da live não "pular".
class IrnPcm extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 1024;
    this.l = new Float32Array(this.size);
    this.r = new Float32Array(this.size);
    this.n = 0;
  }

  process(inputs) {
    const input = inputs[0] || [];
    const l = input[0];
    const r = input[1] || input[0];
    const frames = l ? l.length : 128;
    for (let i = 0; i < frames; i++) {
      this.l[this.n] = l ? l[i] : 0;
      this.r[this.n] = r ? r[i] : 0;
      this.n++;
      if (this.n === this.size) {
        this.port.postMessage({ l: this.l, r: this.r }, [this.l.buffer, this.r.buffer]);
        this.l = new Float32Array(this.size);
        this.r = new Float32Array(this.size);
        this.n = 0;
      }
    }
    return true;
  }
}

registerProcessor('irn-pcm', IrnPcm);
