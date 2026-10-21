// The design system's public surface. App code imports from "@/design-system"
// and never styles these elements itself.

export { AmButton, type AmButtonProps } from "./buttons/AmButton";
export { AmPill, type AmPillProps, type AmPillTone } from "./pills/AmPill";
export { AmTierPill, AmStatusPill, AmKindPill, KIND_LABEL } from "./pills/AmMatchPills";
export { AmMoney, type AmMoneyProps } from "./money/AmMoney";
export { AmCheckList, type AmCheckItem, type AmCheckState } from "./checks/AmCheckList";
export { Colors, Theme, themeCss } from "./colors";
export { formatMoney, formatMoneyWhole, formatAccounting, formatShortDate } from "./format";
