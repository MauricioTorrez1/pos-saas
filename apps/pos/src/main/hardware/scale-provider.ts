/** Reads a weight in thousandths of the base unit, so 1.25 kg is 1250 and no fraction ever appears. */
export interface ScaleProvider {
  /**
   * Reads what is on the scale.
   *
   * @returns the weight as a non-negative safe integer, in thousandths of a kilogram
   * @throws DeviceError if no reading can be taken
   */
  readWeightMilli(): Promise<number>;
}
