import React from "react";
import { cn } from "../../lib/utils";

const Card = ({ className, ...props }) => (
  <div className={cn("rounded-lg border bg-white p-4 shadow-sm", className)} {...props} />
);

const CardContent = ({ className, ...props }) => (
  <div className={cn("p-4", className)} {...props} />
);

export { Card, CardContent };