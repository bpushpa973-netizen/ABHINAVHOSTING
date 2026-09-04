import { Router, type IRouter } from "express";
import healthRouter from "./health";
import storageRouter from "./storage";
import botsRouter from "./bots";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storageRouter);
router.use(botsRouter);

export default router;
