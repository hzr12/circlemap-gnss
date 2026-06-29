/**
 * 轨迹管理 — 从 app.js 拆出的独立模块 (#18)
 * =============================================
 * 轨迹点存储、采样、距离计算
 */

class Trail {
  constructor() {
    this.positions = [];      // 轨迹点数组
    this.lastPos = null;      // 上次记录的位置（用于采样）
    this.isRecording = false; // 是否正在记录
  }

  /**
   * 开始新记录（清空旧轨迹）
   */
  start() {
    this.positions = [];
    this.lastPos = null;
    this.isRecording = true;
  }

  /**
   * 停止记录
   */
  stop() {
    this.isRecording = false;
  }

  /**
   * 清除所有轨迹点
   */
  clear() {
    this.positions = [];
    this.lastPos = null;
  }

  /**
   * 采样记录一个轨迹点（每 >10m 采一个点，最多 500 个）
   * @param {{lat:number,lng:number,wgsLat?:number,wgsLng?:number,time?:number,accuracy?:number,speed?:number,heading?:number}} pt
   * @returns {boolean} 是否实际添加了点
   */
  addPoint(pt) {
    if (!pt) return false;
    if (this.lastPos && calcDistance(
      { lat: pt.lat, lng: pt.lng },
      { lat: this.lastPos.lat, lng: this.lastPos.lng }
    ) <= CONFIG.TRAIL_SAMPLE_MIN_DIST) {
      return false;
    }
    this.positions.push(pt);
    this.lastPos = pt;
    if (this.positions.length > CONFIG.TRAIL_MAX_POINTS) {
      this.positions = this.positions.slice(-CONFIG.TRAIL_MAX_POINTS);
    }
    return true;
  }

  /**
   * 计算轨迹总距离
   * @returns {number} 米
   */
  getDistance() {
    if (this.positions.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < this.positions.length; i++) {
      total += calcDistance(
        { lat: this.positions[i-1].lat, lng: this.positions[i-1].lng },
        { lat: this.positions[i].lat, lng: this.positions[i].lng }
      );
    }
    return total;
  }

  /**
   * @returns {number} 轨迹点数量
   */
  getPointCount() {
    return this.positions.length;
  }
}
