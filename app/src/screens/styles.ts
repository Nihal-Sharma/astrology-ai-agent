import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0b0f19",
    paddingHorizontal: 24,
    paddingTop: 96,
  },

  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#f5f7ff",
    marginBottom: 8,
  },

  subtitle: {
    fontSize: 15,
    color: "#9aa3b8",
    marginBottom: 32,
    lineHeight: 21,
  },

  planBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#1a1f33",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 16,
  },

  planBadgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#6c5ce7",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  label: {
    fontSize: 13,
    color: "#9aa3b8",
    marginBottom: 6,
    marginTop: 16,
  },

  input: {
    backgroundColor: "#161c2c",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: "#f5f7ff",
    borderWidth: 1,
    borderColor: "#262e44",
  },

  button: {
    backgroundColor: "#6c5ce7",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 28,
  },

  buttonDisabled: {
    opacity: 0.5,
  },

  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },

  secondaryButton: {
    alignItems: "center",
    marginTop: 16,
    paddingVertical: 8,
  },

  secondaryButtonText: {
    color: "#9aa3b8",
    fontSize: 14,
  },

  error: {
    color: "#ff6b6b",
    fontSize: 14,
    marginTop: 16,
  },

  hint: {
    color: "#5b8def",
    fontSize: 13,
    marginTop: 12,
  },

  row: {
    flexDirection: "row",
    gap: 12,
  },

  rowItem: {
    flex: 1,
  },
});
