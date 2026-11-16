import type { NavAirport, NavSet, Procedure } from "./nav";
import { emptyNavSet, addFix, addAirport } from "./nav";

// Minimal protobuf wire reader for vNAS NavData.dat (message NavDataSet).
// Schema: airports=1, fixes=2, airways=3, sids=4, stars=5.
class Reader {
  pos: number;
  private dv: DataView;
  constructor(
    private buf: Uint8Array,
    start = 0,
    public end = buf.length,
  ) {
    this.pos = start;
    this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  get more() {
    return this.pos < this.end;
  }
  varint(): number {
    let result = 0;
    let mul = 1;
    for (;;) {
      if (this.pos >= this.end) throw new Error("Truncated nav data");
      const b = this.buf[this.pos++];
      result += (b & 0x7f) * mul;
      if (!(b & 0x80)) return result;
      mul *= 128;
    }
  }
  tag(): [field: number, wire: number] {
    const t = this.varint();
    return [Math.floor(t / 8), t & 7];
  }
  double(): number {
    const v = this.dv.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }
  sub(): Reader {
    const len = this.varint();
    const r = new Reader(this.buf, this.pos, this.pos + len);
    this.pos += len;
    if (this.pos > this.end) throw new Error("Truncated nav data");
    return r;
  }
  string(): string {
    const len = this.varint();
    const s = decoder.decode(this.buf.subarray(this.pos, this.pos + len));
    this.pos += len;
    return s;
  }
  skip(wire: number) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) {
      const len = this.varint();
      this.pos += len;
    }
    else if (wire === 5) this.pos += 4;
    else throw new Error("Unsupported wire type " + wire);
  }
}
const decoder = new TextDecoder();

function geo(r: Reader) {
  let lat = 0;
  let lon = 0;
  while (r.more) {
    const [f, w] = r.tag();
    if (f === 1 && w === 1) lat = r.double();
    else if (f === 2 && w === 1) lon = r.double();
    else r.skip(w);
  }
  return { lat, lon };
}

function airport(r: Reader): NavAirport {
  const a: NavAirport = { faaId: "", icaoId: "", name: "", lat: 0, lon: 0, elevation: 0, runways: [] };
  while (r.more) {
    const [f, w] = r.tag();
    if (f === 1 && w === 2) a.faaId = r.string();
    else if (f === 2 && w === 2) a.icaoId = r.string();
    else if (f === 4 && w === 2) a.name = r.string();
    else if (f === 5 && w === 1) a.elevation = r.double();
    else if (f === 6 && w === 2) Object.assign(a, geo(r.sub()));
    else if (f === 7 && w === 2) {
      const rr = r.sub();
      const rw = { id: "", heading: 0, lat: 0, lon: 0, endLat: 0, endLon: 0 };
      while (rr.more) {
        const [rf, rwire] = rr.tag();
        if (rf === 1 && rwire === 2) rw.id = rr.string();
        else if (rf === 2 && rwire === 1) rw.heading = rr.double();
        else if (rf === 5 && rwire === 2) Object.assign(rw, geo(rr.sub()));
        else if (rf === 6 && rwire === 2) {
          const g = geo(rr.sub());
          rw.endLat = g.lat;
          rw.endLon = g.lon;
        } else rr.skip(rwire);
      }
      a.runways.push(rw);
    } else r.skip(w);
  }
  return a;
}

function procedure(r: Reader, bodyField: number, transField: number): Procedure {
  const p: Procedure = { id: "", body: [], transitions: [] };
  while (r.more) {
    const [f, w] = r.tag();
    if (f === 1 && w === 2) p.id = r.string();
    else if (f === bodyField && w === 2) p.body.push(r.string());
    else if (f === transField && w === 2) {
      const t = r.sub();
      const fixes: string[] = [];
      while (t.more) {
        const [tf, tw] = t.tag();
        if (tf === 1 && tw === 2) fixes.push(t.string());
        else t.skip(tw);
      }
      p.transitions.push(fixes);
    } else r.skip(w);
  }
  return p;
}

export function decodeNavData(bytes: Uint8Array, label = "vNAS NavData"): NavSet {
  const set = emptyNavSet(label);
  const r = new Reader(bytes);
  while (r.more) {
    const [f, w] = r.tag();
    if (w !== 2) {
      r.skip(w);
      continue;
    }
    if (f === 1) addAirport(set, airport(r.sub()));
    else if (f === 2) {
      const fr = r.sub();
      let id = "";
      let loc = { lat: 0, lon: 0 };
      while (fr.more) {
        const [ff, fw] = fr.tag();
        if (ff === 1 && fw === 2) id = fr.string();
        else if (ff === 2 && fw === 2) loc = geo(fr.sub());
        else fr.skip(fw);
      }
      if (id) addFix(set, id, loc);
    } else if (f === 4) set.sids.push(procedure(r.sub(), 2, 3));
    else if (f === 5) set.stars.push(procedure(r.sub(), 3, 2));
    else r.skip(w);
  }
  return set;
}
