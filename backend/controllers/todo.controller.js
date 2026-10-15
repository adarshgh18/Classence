const Todo = require('../models/Todo');

const getTodos = async (req, res, next) => {
  try {
    const todos = await Todo.find({ user: req.user._id }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, todos });
  } catch (error) {
    next(error);
  }
};

const createTodo = async (req, res, next) => {
  try {
    const { title, description } = req.body;
    if (!title) {
      return res.status(400).json({ success: false, error: 'Title is required' });
    }
    
    const todo = new Todo({
      title,
      description: description || '',
      user: req.user._id
    });
    
    await todo.save();
    return res.status(201).json({ success: true, todo });
  } catch (error) {
    next(error);
  }
};

const updateTodo = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, isCompleted } = req.body;
    
    const todo = await Todo.findOne({ _id: id, user: req.user._id });
    if (!todo) {
      return res.status(404).json({ success: false, error: 'Todo not found or unauthorized' });
    }
    
    if (title !== undefined) todo.title = title;
    if (isCompleted !== undefined) todo.isCompleted = isCompleted;
    
    await todo.save();
    return res.status(200).json({ success: true, todo });
  } catch (error) {
    next(error);
  }
};

const deleteTodo = async (req, res, next) => {
  try {
    const { id } = req.params;
    const todo = await Todo.findOne({ _id: id, user: req.user._id });
    if (!todo) {
      return res.status(404).json({ success: false, error: 'Todo not found or unauthorized' });
    }
    
    await Todo.findByIdAndDelete(id);
    return res.status(200).json({ success: true, message: 'Todo deleted successfully' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getTodos,
  createTodo,
  updateTodo,
  deleteTodo
};
