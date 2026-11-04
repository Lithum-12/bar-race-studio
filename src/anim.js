/* ============================================================
 * ===== 播放时钟 =====
 * ============================================================
 * t 的单位是「周期序号」。节奏用每周期停留几秒来表达，
 * 而不是总时长：周期多的数据集会自动获得更多时间，
 * 不会因为数据变长而整体变快。
 * ============================================================ */

export function createClock() {
  return {
    t: 0,
    total: 1,
    perPeriod: 1,
    playing: false,
    loop: false,
    atEnd: false,

    get seconds() {
      return this.total * this.perPeriod;
    },

    setTotal(n) {
      this.total = Math.max(1, n);
      this.t = Math.min(this.t, this.total);
    },

    seek(fraction) {
      this.t = Math.max(0, Math.min(1, fraction)) * this.total;
      this.atEnd = false;
    },

    restart() {
      this.t = 0;
      this.atEnd = false;
      this.playing = true;
    },

    /* 返回本次 tick 是否刚好走到终点 */
    tick(dt) {
      if (!this.playing) return false;
      this.t += dt / this.perPeriod;
      if (this.t < this.total) return false;
      this.t = this.total;
      if (this.loop) {
        this.atEnd = false;
        return true;
      }
      this.playing = false;
      const first = !this.atEnd;
      this.atEnd = true;
      return first;
    },
  };
}
