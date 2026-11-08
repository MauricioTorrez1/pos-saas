/** Opens the cash drawer. Only checkout calls it, and only after a cash sale is saved as completed. */
export interface CashDrawer {
  /**
   * Opens the drawer.
   *
   * @returns once the drawer received the command
   * @throws DeviceError if the drawer, or the printer it hangs from, does not respond
   */
  open(): Promise<void>;
}
