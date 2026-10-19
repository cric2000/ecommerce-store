import express from 'express';
import app from './dist/app.js';

export default express().use(app);
