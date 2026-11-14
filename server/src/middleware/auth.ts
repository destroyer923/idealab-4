import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { UserModel } from "../models/User.js";

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    status: string;
  };
}

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      res.status(401).json({ code: "unauthenticated", message: "Authentication required" });
      return;
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      res.status(500).json({ code: "server_error", message: "JWT secret is not configured" });
      return;
    }

    const token = header.slice("Bearer ".length).trim();
    const payload = jwt.verify(token, secret) as { userId?: string };
    if (!payload.userId) {
      res.status(401).json({ code: "unauthenticated", message: "Invalid token payload" });
      return;
    }

    const user = await UserModel.findOne({ id: payload.userId }).select("id email role status");
    if (!user) {
      res.status(401).json({ code: "unauthenticated", message: "User no longer exists" });
      return;
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
    };
    next();
  } catch {
    res.status(401).json({ code: "unauthenticated", message: "Authentication failed" });
  }
}

export function isAdminRole(role: string | undefined): boolean {
  return role === "admin";
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ code: "unauthenticated", message: "err.unauthenticated" });
    return;
  }
  if (!isAdminRole(req.user.role)) {
    res.status(403).json({ code: "forbidden", message: "verify.err.reviewerOnly" });
    return;
  }
  next();
}
