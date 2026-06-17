import { Router, type IRouter } from "express";
import healthRouter from "./health";
import gameRouter from "./game";
import authRouter from "./auth";
import eloRouter from "./elo";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(eloRouter);
router.use(gameRouter);

export default router;
