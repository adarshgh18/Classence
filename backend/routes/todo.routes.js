const express = require('express');
const router = express.Router();
const todoController = require('../controllers/todo.controller');
const { protect } = require('../middleware/auth');

router.use(protect);

router.get('/', todoController.getTodos);
router.post('/create', todoController.createTodo);
router.put('/update/:id', todoController.updateTodo);
// Frontend uses POST for delete: axios.post('/todo/delete/:id')
router.post('/delete/:id', todoController.deleteTodo);

module.exports = router;
