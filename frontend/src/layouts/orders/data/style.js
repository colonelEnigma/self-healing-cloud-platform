function ordersDialog(theme) {
  const { palette, borders, transitions } = theme;
  const { background, text, action, divider } = palette;
  const { borderRadius } = borders;

  return {
    "& .MuiDialogTitle-root": {
      backgroundColor: background.default,
      color: text.primary,
      borderRadius: borderRadius.md,
      transition: transitions.create("background-color", {
        easing: transitions.easing.easeInOut,
        duration: transitions.duration.standard,
      }),
    },

    "& .MuiDialogContent-root": {
      backgroundColor: background.paper,
      color: text.secondary,
      borderTop: `1px solid ${divider}`,
      transition: transitions.create("color", {
        easing: transitions.easing.easeInOut,
        duration: transitions.duration.shortest,
      }),
    },

    "& .MuiDialogActions-root": {
      backgroundColor: background.default,
      "& button": {
        color: text.primary,
        transition: "color 100ms linear",
        "&:hover": {
          backgroundColor: action.hover,
        },
      },
    },
  };
}

export default ordersDialog;
